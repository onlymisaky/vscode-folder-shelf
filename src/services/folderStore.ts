import * as vscode from 'vscode';
import { ConfigFileError } from './configFileError';
import { itemSchema, rawFileSchema, formatIssues, topLevelErrorKind } from './configSchema';
import type { UsableItem } from './configSchema';

/** 携带分组与标签信息的条目视图（getAllWithMeta 返回） */
export interface ItemMeta {
  /** 条目绝对路径对应的资源 Uri */
  readonly uri: vscode.Uri;
  /** 所属分组名；undefined 表示未分组 */
  readonly group?: string;
  /** 标签列表；undefined 表示无标签 */
  readonly tags?: string[];
}

/** 新增条目的统计结果。 */
export interface AddItemsResult {
  /** 实际写入存储的新条目数量，取值不小于 0 */
  readonly added: number;
  /** 因路径重复而跳过的条目数量，取值不小于 0 */
  readonly skipped: number;
}

/** 单个条目的标签替换请求。 */
export interface ItemTagUpdate {
  /** 用于定位待更新条目的绝对资源 Uri */
  readonly uri: vscode.Uri;
  /** 替换后的完整标签集合；允许空数组表示清除全部标签 */
  readonly tags: readonly string[];
}

/** 无法渲染的无效条目（原始对象）及其校验失败原因（树占位节点展示用） */
export interface InvalidItemNote {
  /** 未通过 itemSchema 的原始条目（文件中保持原样） */
  readonly item: unknown;
  /** zod issue 文案，如 `items[3].path: Invalid input: expected string, received number` */
  readonly issue: string;
}

/**
 * config.json 的内存快照：top 为顶层原始对象（未知字段保留，写回时整体 spread）；
 * items 为逐条 itemSchema 校验后的数组——通过校验的是 looseObject 解析产物（未知字段随对象保留），
 * 未通过的是原始对象（文件内容保持原样、不参与渲染与操作）。
 */
interface RawConfigFile {
  readonly top: Record<string, unknown>;
  readonly items: readonly unknown[];
  readonly invalidNotes: ReadonlyArray<InvalidItemNote>;
}

/**
 * 标签集合 normalize：逐个 trim、去空、去重；结果为空视为无标签（undefined）。
 * 仅用于写路径（用户显式设置标签），读路径不做任何清洗。
 *
 * @param tags - 原始标签集合，允许含非字符串脏元素；undefined 视为无标签
 * @returns 清洗后的标签数组（非空、去重、保持首现顺序）；无有效标签时为 undefined
 */
function normalizeTags(tags: readonly unknown[] | undefined): string[] | undefined {
  const cleaned = [
    ...new Set(
      (tags ?? [])
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== '')
    ),
  ];
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * 标签集合逐项比较（顺序敏感，保持用户勾选顺序）。
 *
 * @param a - 左侧标签集合；undefined 视为无标签
 * @param b - 右侧标签集合；undefined 视为无标签
 * @returns 两集合均为 undefined，或长度相同且逐项相等时为 true
 */
function sameTags(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

/**
 * 渲染守卫：条目 path（与 itemSchema 判据一致——对象且为非空字符串才可用）。
 * read 已完成权威校验，此守卫供操作层快速判别可用条目。
 *
 * @param raw - 原始条目（或解析产物）
 * @returns 可用的 path；条目无效时为 undefined
 */
function usablePath(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>).path;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 条目路径与菜单回传 Uri 之间的同一性桥接：Uri.file 会为相对路径补前导斜杠，
 * 树侧 uri 由 Uri.file(路径) 构造，因此存储侧匹配必须经过同一推导，
 * 否则相对路径条目在移除/改组/打标签/去重时无法命中（绝对路径推导前后不变，行为不受影响）。
 *
 * @param p - usablePath 产出的原始条目路径
 * @returns 与树侧 uri.fsPath 一致的匹配键
 */
function fsPathOf(p: string): string {
  return vscode.Uri.file(p).fsPath;
}

/**
 * 渲染守卫：条目 group（仅字符串有效，其余类型显示为未分组，不改写文件）。
 */
function groupOf(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>).group;
  return typeof value === 'string' ? value : undefined;
}

/**
 * 渲染守卫：条目 tags 原始数组（仅数组有效，其余类型显示为无标签，不改写文件）。
 */
function rawTagsOf(raw: unknown): readonly unknown[] | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>).tags;
  return Array.isArray(value) ? value : undefined;
}

/**
 * 渲染投影：过滤非字符串元素后的标签集合；空集合视为无标签（undefined）。
 * 仅影响显示，不改写文件。
 */
function displayTags(tags: readonly unknown[] | undefined): string[] | undefined {
  const cleaned = (tags ?? []).filter((tag): tag is string => typeof tag === 'string');
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * 条目既有标签（字符串投影）是否与新集合相同：仅当既有值为纯字符串数组时才可能相同，
 * 含脏元素视为不同（该条目被显式写标签时整体规范化替换）。
 */
function sameItemTags(item: UsableItem, next: readonly string[] | undefined): boolean {
  const raw = rawTagsOf(item);
  if (raw === undefined) {
    return next === undefined;
  }
  if (!raw.every((tag) => typeof tag === 'string')) {
    return false;
  }
  return sameTags(raw, next);
}

/**
 * 以独立的 JSON 文件持久化用户添加的文件夹/文件列表。
 * 读路径统一经 getRawItems（内存缓存优先，未加载才读盘；读取失败缓存 ConfigFileError，
 * 直到 refresh/setFile，期间所有写操作拒绝执行以保护损坏文件）；
 * 写路径统一经 commit（写盘 → 更新缓存 → 广播 onDidChange），只改写命中字段，
 * 顶层与条目的未知字段、无效条目一律原样保留（不自动清洗用户配置）。
 */
export class FolderStore implements vscode.Disposable {
  /** 数据变更事件发射器（commit 成功后触发） */
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** 数据变更事件（树视图订阅后整体刷新） */
  readonly onDidChange = this._onDidChange.event;

  /** 当前持久化文件的 Uri（folderShelf.configFile 设置变更时经 setFile 更新） */
  private fileUri: vscode.Uri;
  /** 持久化文件所在目录（写盘前确保存在） */
  private storageDir: vscode.Uri;
  /** 配置文件内存快照；undefined 表示尚未从 JSON 文件加载 */
  private cache: RawConfigFile | undefined;
  /** 最近一次读取失败；缓存到 refresh/setFile 为止，保证同一读取代内抛同一错误对象（弹窗按对象去重） */
  private readError: ConfigFileError | undefined;

  /**
   * 创建使用指定配置文件的收藏存储。
   *
   * @param fileUri - config.json 的绝对资源 Uri
   */
  constructor(fileUri: vscode.Uri) {
    this.fileUri = fileUri;
    this.storageDir = vscode.Uri.joinPath(fileUri, '..');
  }

  /**
   * 切换持久化文件位置（设置变更时调用）：重置缓存并触发刷新，下次 getAll 从新文件加载。
   *
   * @param fileUri - 新的 config.json 完整路径；与当前路径相同则忽略
   */
  setFile(fileUri: vscode.Uri): void {
    if (fileUri.fsPath === this.fileUri.fsPath) {
      return;
    }
    this.fileUri = fileUri;
    this.storageDir = vscode.Uri.joinPath(fileUri, '..');
    this.cache = undefined;
    this.readError = undefined;
    this._onDidChange.fire();
  }

  /**
   * 丢弃缓存并触发刷新，下次 getAll 重新从 JSON 文件加载（文件可能在外部被修改）。
   */
  refresh(): void {
    this.cache = undefined;
    this.readError = undefined;
    this._onDidChange.fire();
  }

  /**
   * 获取当前持久化文件的位置。
   *
   * @returns 当前 config.json 的绝对资源 Uri；设置变更后会同步更新
   */
  get file(): vscode.Uri {
    return this.fileUri;
  }

  /**
   * 确保持久化文件存在：文件缺失时创建父目录，并写入当前缓存条目或空列表。
   */
  async ensureFile(): Promise<void> {
    try {
      await vscode.workspace.fs.stat(this.fileUri);
    } catch (error) {
      // 仅文件不存在才需要创建，其余错误（权限等）原样抛出
      if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
        throw error;
      }
      await this.save(this.cache?.items ?? []);
    }
  }

  /**
   * 获取全部登记条目（文件夹/文件），首次调用时从 JSON 文件加载。
   *
   * @returns 全部条目的资源 Uri 列表（按登记顺序；无效条目不含在内）
   */
  async getAll(): Promise<vscode.Uri[]> {
    const items = await this.getRawItems();
    return items.flatMap((item) => {
      const p = usablePath(item);
      return p === undefined ? [] : [vscode.Uri.file(p)];
    });
  }

  /**
   * 获取全部条目及其分组名、标签列表（树渲染用）。
   *
   * @returns 条目视图数组（按登记顺序；无效条目不含在内）
   */
  async getAllWithMeta(): Promise<ItemMeta[]> {
    const items = await this.getRawItems();
    return items.flatMap((item): ItemMeta[] => {
      const p = usablePath(item);
      if (p === undefined) {
        return [];
      }
      return [{
        uri: vscode.Uri.file(p),
        group: groupOf(item),
        tags: displayTags(rawTagsOf(item)),
      }];
    });
  }

  /**
   * 派生的分组名列表：按条目在列表中首次出现的顺序去重。
   * 分组仅在仍有成员时存在，分组名不单独持久化；「未分组」虚拟节点由 Entry kind 标识。
   *
   * @returns 分组名数组（可能为空）
   */
  async getGroups(): Promise<string[]> {
    const groups: string[] = [];
    for (const item of await this.getRawItems()) {
      const group = groupOf(item);
      if (group && !groups.includes(group)) {
        groups.push(group);
      }
    }
    return groups;
  }

  /**
   * 派生的标签列表：按条目在列表中首次出现的顺序去重。标签仅在仍被引用时存在，名称不单独持久化。
   *
   * @returns 标签名数组（可能为空）
   */
  async getTags(): Promise<string[]> {
    const tags: string[] = [];
    for (const item of await this.getRawItems()) {
      for (const tag of displayTags(rawTagsOf(item)) ?? []) {
        if (!tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }
    return tags;
  }

  /**
   * 获取无法渲染的无效条目及其校验失败原因（树占位节点展示用）。
   *
   * @returns 无效条目备注列表；读取成功后始终与文件内容对应，未加载或读取失败时为空
   */
  getInvalidNotes(): ReadonlyArray<InvalidItemNote> {
    return this.cache?.invalidNotes ?? [];
  }

  /**
   * 新增条目（文件夹/文件，按路径去重，一律未分组）。
   *
   * @param uris - 待添加的资源 Uri 列表；与已登记条目 fsPath 相同的会被跳过
   * @returns added 为实际新增数，skipped 为因重复被跳过的数量；无新增时不写盘、不触发 onDidChange
   */
  async add(uris: readonly vscode.Uri[]): Promise<AddItemsResult> {
    const items = await this.getRawItems();
    const known = new Set(items.flatMap((item) => {
      const p = usablePath(item);
      return p === undefined ? [] : [fsPathOf(p)];
    }));
    const added: vscode.Uri[] = [];
    for (const uri of uris) {
      if (known.has(uri.fsPath)) {
        continue;
      }
      known.add(uri.fsPath);
      added.push(uri);
    }

    if (added.length === 0) {
      return { added: 0, skipped: uris.length };
    }

    await this.commit([...items, ...added.map((uri) => ({ path: uri.fsPath }))]);
    return { added: added.length, skipped: uris.length - added.length };
  }

  /**
   * 从列表移除指定条目（不影响磁盘文件，其余条目的分组字段保留）。
   * 仅命中可用条目；无效条目在文件中原样保留。
   *
   * @param uris - 待移除的资源 Uri 列表；未登记的自动忽略
   * @returns 实际移除的条目数；无命中时不写盘、不触发 onDidChange
   */
  async remove(uris: readonly vscode.Uri[]): Promise<number> {
    const items = await this.getRawItems();
    const doomed = new Set(uris.map((uri) => uri.fsPath));
    const updated = items.filter((item) => {
      const p = usablePath(item);
      return p === undefined || !doomed.has(fsPathOf(p));
    });
    if (updated.length === items.length) {
      return 0;
    }

    await this.commit(updated);
    return items.length - updated.length;
  }

  /**
   * 批量字段替换的共享实现：仅命中可用条目并经 patch 生成新对象，patch 对无变化条目必须原样返回，
   * 借对象同一性统计实际变化数；无效条目原样跳过；无任何变化时不写盘、不触发刷新。
   *
   * @param uris - 目标条目的 Uri 列表
   * @param patch - 单条目替换函数：入参为解析产物（含未知字段），返回新条目（无变化时须返回原对象）
   * @returns 发生变化的条目数
   */
  private async patchItems(
    uris: readonly vscode.Uri[],
    patch: (item: UsableItem) => UsableItem
  ): Promise<number> {
    const items = await this.getRawItems();
    const targets = new Set(uris.map((uri) => uri.fsPath));
    const updated = items.map((item) => {
      const p = usablePath(item);
      return p !== undefined && targets.has(fsPathOf(p)) ? patch(item as UsableItem) : item;
    });

    const changed = updated.filter((item, index) => item !== items[index]).length;
    if (changed === 0) {
      return 0;
    }
    await this.commit(updated);
    return changed;
  }

  /**
   * 设置条目所属分组，同时保留路径、标签等其他元数据与未知字段。
   *
   * @param uris - 目标条目的 Uri 列表
   * @param group - 目标分组名；undefined 表示移出分组
   * @returns 发生变化的条目数；无实际变化时不写盘、不触发 onDidChange
   */
  async setItemGroups(uris: readonly vscode.Uri[], group: string | undefined): Promise<number> {
    return this.patchItems(uris, (item) => {
      if (item.group === group) {
        return item;
      }
      return { ...item, group };
    });
  }

  /**
   * 以替换语义设置条目标签集合，同时保留路径、分组等其他元数据与未知字段。
   *
   * @param uris - 目标条目的 Uri 列表
   * @param tags - 新标签集合（名称统一 trim、去空、去重）；undefined 或空集表示清除全部标签
   * @returns 发生变化的条目数；无实际变化时不写盘、不触发 onDidChange
   */
  async setItemTags(
    uris: readonly vscode.Uri[],
    tags: readonly string[] | undefined
  ): Promise<number> {
    const next = normalizeTags(tags);
    return this.patchItems(uris, (item) => {
      if (sameItemTags(item, next)) {
        return item;
      }
      return { ...item, tags: next };
    });
  }

  /**
   * 批量为各条目独立设置标签集合（拖拽等按条目计算结果的场景），normalize/sameItemTags 规则同 setItemTags。
   *
   * @param updates - 逐条目的更新列表（uri 定位条目，tags 为该条目的新标签集合）
   * @returns 发生变化的条目数；无实际变化时不写盘、不触发刷新
   */
  async applyItemTags(
    updates: readonly ItemTagUpdate[]
  ): Promise<number> {
    const tagsByPath = new Map(updates.map(({ uri, tags }) => [uri.fsPath, tags]));
    return this.patchItems(
      updates.map(({ uri }) => uri),
      (item) => {
        const next = normalizeTags(tagsByPath.get(item.path) ?? []);
        if (sameItemTags(item, next)) {
          return item;
        }
        return { ...item, tags: next };
      }
    );
  }

  /**
   * 重命名分组：批量改写所属条目的 group 字段（组的显示位置随首个成员移动）。
   *
   * @param oldName - 现分组名
   * @param newName - 新分组名；空白或与现名相同则不处理
   * @returns 改写的条目数；无命中或无变化时不写盘、不触发 onDidChange
   */
  async renameGroup(oldName: string, newName: string): Promise<number> {
    if (!newName || oldName === newName) {
      return 0;
    }

    const items = await this.getRawItems();
    const updated = items.map((item) => (
      groupOf(item) === oldName ? { ...(item as UsableItem), group: newName } : item
    ));

    const changed = updated.filter((item, index) => item !== items[index]).length;
    if (changed === 0) {
      return 0;
    }
    await this.commit(updated);
    return changed;
  }

  /**
   * 解散分组：所属条目回到未分组，其路径和标签保持不变；分组随之从派生集合中消失。
   *
   * @param name - 要解散的分组名
   * @returns 移出该分组的条目数；无命中时不写盘、不触发 onDidChange
   */
  async dissolveGroup(name: string): Promise<number> {
    const items = await this.getRawItems();
    const updated = items.map((item) => (
      groupOf(item) === name ? { ...(item as UsableItem), group: undefined } : item
    ));

    const changed = updated.filter((item, index) => item !== items[index]).length;
    if (changed === 0) {
      return 0;
    }
    await this.commit(updated);
    return changed;
  }

  /**
   * 重命名标签：批量改写所有持有该标签条目的 tags 字段（新名与条目既有标签同名时自然合并去重）。
   * 仅替换命中元素，其余元素（含非字符串脏元素）原样保留。
   *
   * @param oldName - 现标签名
   * @param newName - 新标签名；空白或与现名相同则不处理
   * @returns 改写的条目数；无命中或无变化时不写盘、不触发 onDidChange
   */
  async renameTag(oldName: string, newName: string): Promise<number> {
    if (!newName || oldName === newName) {
      return 0;
    }

    const items = await this.getRawItems();
    const updated = items.map((item) => {
      const tags = rawTagsOf(item);
      if (!tags?.includes(oldName)) {
        return item;
      }
      const next = [...new Set(tags.map((tag) => (tag === oldName ? newName : tag)))];
      return { ...(item as UsableItem), tags: next };
    });

    const changed = updated.filter((item, index) => item !== items[index]).length;
    if (changed === 0) {
      return 0;
    }
    await this.commit(updated);
    return changed;
  }

  /**
   * 删除标签：从所有持有该标签的条目中移除该标签（条目本身保留），标签随之从派生集合中消失。
   * 仅移除命中元素，其余元素（含非字符串脏元素）原样保留。
   *
   * @param name - 要删除的标签名
   * @returns 改写的条目数；无命中时不写盘、不触发 onDidChange
   */
  async deleteTag(name: string): Promise<number> {
    const items = await this.getRawItems();
    const updated = items.map((item) => {
      const tags = rawTagsOf(item);
      if (!tags?.includes(name)) {
        return item;
      }
      const next = tags.filter((tag) => tag !== name);
      // 命中即必有变化；删除最后一个标签时保留条目的分组等其他元数据
      return { ...(item as UsableItem), tags: next.length > 0 ? next : undefined };
    });

    const changed = updated.filter((item, index) => item !== items[index]).length;
    if (changed === 0) {
      return 0;
    }
    await this.commit(updated);
    return changed;
  }

  /** 释放事件发射器（扩展停用时由 context.subscriptions 统一调用）。 */
  dispose(): void {
    this._onDidChange.dispose();
  }

  /**
   * 读取全部原始条目（内部统一读路径）：优先内存快照，未加载时读盘一次；
   * 最近一次读取失败时持续抛出同一 ConfigFileError（直到 refresh/setFile），
   * 使损坏配置期间所有写操作 fail-closed。
   *
   * @returns 条目原始数组（通过校验的为解析产物，未通过的为原始对象）
   * @throws ConfigFileError（JSON 语法/结构错误）或非 FileNotFound 的读错误时抛出
   */
  private async getRawItems(): Promise<readonly unknown[]> {
    if (this.readError) {
      throw this.readError;
    }
    if (!this.cache) {
      try {
        this.cache = await this.read();
      } catch (error) {
        if (error instanceof ConfigFileError) {
          this.readError = error;
        }
        throw error;
      }
    }
    return this.cache.items;
  }

  /**
   * 提交一次变更：写盘、更新快照、触发视图刷新。
   * 仅替换 items；顶层未知字段与无效条目备注沿用当前快照。
   *
   * @param items - 变更后的完整条目数组（原始对象/解析产物混合）
   */
  private async commit(items: readonly unknown[]): Promise<void> {
    await this.save(items);
    this.cache = {
      top: this.cache?.top ?? {},
      items: [...items],
      invalidNotes: this.cache?.invalidNotes ?? [],
    };
    this._onDidChange.fire();
  }

  /**
   * 从 JSON 文件读取并校验条目数据（不触碰缓存）：不清洗、不改写任何内容。
   * JSON 语法错误与结构错误（顶层非对象 / items 非数组）抛 ConfigFileError；
   * 未通过 itemSchema 的条目保留原始对象并记入 invalidNotes。
   *
   * @returns 配置文件内存快照；文件不存在时为空快照
   * @throws ConfigFileError，或发生非 FileNotFound 的读错误时原样抛出
   */
  private async read(): Promise<RawConfigFile> {
    let content: Uint8Array;
    try {
      content = await vscode.workspace.fs.readFile(this.fileUri);
    } catch (error) {
      // 文件尚未创建时视为空列表
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return { top: {}, items: [], invalidNotes: [] };
      }
      throw error;
    }

    // 剥离 UTF-8 BOM：部分编辑器保存的文件带 BOM，JSON.parse 不接受
    let text = new TextDecoder().decode(content);
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw ConfigFileError.parseFailed(text, error, this.fileUri);
    }

    const topResult = rawFileSchema.safeParse(data);
    if (!topResult.success) {
      throw ConfigFileError.schemaFailed(
        topLevelErrorKind(topResult.error.issues),
        formatIssues(topResult.error.issues),
        this.fileUri
      );
    }

    // 逐条目校验分区：通过 → 解析产物（未知字段保留）；未通过 → 原始对象原样保留并记录原因
    const items: unknown[] = [];
    const invalidNotes: InvalidItemNote[] = [];
    topResult.data.items?.forEach((rawItem, index) => {
      const result = itemSchema.safeParse(rawItem);
      if (result.success) {
        items.push(result.data);
      } else {
        invalidNotes.push({
          item: rawItem,
          issue: `items[${index}]: ${formatIssues(result.error.issues)}`,
        });
      }
    });

    return { top: topResult.data, items, invalidNotes };
  }

  /**
   * 将条目数组序列化为 JSON 写盘（缩进 2 空格，便于手工编辑与 diff），必要时先创建父目录。
   * 顶层未知字段经 spread 原样保留。
   *
   * @param items - 要写入的完整条目数组
   */
  private async save(items: readonly unknown[]): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageDir);
    const data = { ...(this.cache?.top ?? {}), items: [...items] };
    await vscode.workspace.fs.writeFile(
      this.fileUri,
      new TextEncoder().encode(JSON.stringify(data, null, 2))
    );
  }
}
