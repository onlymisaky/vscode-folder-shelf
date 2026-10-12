import * as path from 'node:path';
import * as vscode from 'vscode';

/** config.json 的数据结构 */
interface ConfigFileData {
  /** 收藏条目列表；读取时缺省或类型非法均视为空列表 */
  items?: StoredItem[];
}

/** JSON.parse 后、完成运行时校验前的配置文件结构。 */
interface RawConfigFileData {
  /** 未校验的 items 值；仅数组会进入逐条清洗流程 */
  items?: unknown;
}

/** 单个收藏条目：对象结构便于后期扩展字段（如置顶、备注） */
interface StoredItem {
  /** 条目绝对路径（全表去重键） */
  path: string;
  /** 所属分组名；缺省为未分组。分组集合由全部条目的该字段派生（不单独存储 groups） */
  group?: string;
  /** 标签列表（一个条目可属多个标签）；缺省为无标签。标签集合由全部条目的该字段派生（不单独存储） */
  tags?: string[];
}

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

/**
 * 标签集合 normalize：逐个 trim、去空、去重；结果为空视为无标签（undefined）。
 * 兼容手改 JSON 的脏元素（非字符串直接丢弃）。
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
 * 以独立的 JSON 文件持久化用户添加的文件夹/文件列表。
 * 读路径统一经 getItems（内存缓存优先，未加载才读盘）；
 * 写路径统一经 commit（写盘 → 更新缓存 → 广播 onDidChange），保证缓存与文件一致。
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
  /** 条目内存缓存；undefined 表示尚未从 JSON 文件加载 */
  private cache: StoredItem[] | undefined;

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
    this._onDidChange.fire();
  }

  /**
   * 丢弃缓存并触发刷新，下次 getAll 重新从 JSON 文件加载（文件可能在外部被修改）。
   */
  refresh(): void {
    this.cache = undefined;
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
   * 确保持久化文件存在：文件缺失时创建父目录，并写入当前缓存或空列表。
   */
  async ensureFile(): Promise<void> {
    try {
      await vscode.workspace.fs.stat(this.fileUri);
    } catch (error) {
      // 仅文件不存在才需要创建，其余错误（权限等）原样抛出
      if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
        throw error;
      }
      await this.save(this.cache ?? []);
    }
  }

  /**
   * 获取全部登记条目（文件夹/文件），首次调用时从 JSON 文件加载。
   *
   * @returns 全部条目的资源 Uri 列表（按登记顺序）
   */
  async getAll(): Promise<vscode.Uri[]> {
    const items = await this.getItems();
    return items.map((item) => vscode.Uri.file(item.path));
  }

  /**
   * 获取全部条目及其分组名、标签列表（树渲染用）。
   *
   * @returns 条目视图数组（按登记顺序）
   */
  async getAllWithMeta(): Promise<ItemMeta[]> {
    const items = await this.getItems();
    return items.map((item) => ({
      uri: vscode.Uri.file(item.path),
      group: item.group,
      tags: item.tags,
    }));
  }

  /**
   * 派生的分组名列表：按条目在列表中首次出现的顺序去重。
   * 分组仅在仍有成员时存在，分组名不单独持久化；「未分组」虚拟节点由 Entry kind 标识。
   *
   * @returns 分组名数组（可能为空）
   */
  async getGroups(): Promise<string[]> {
    const groups: string[] = [];
    for (const item of await this.getItems()) {
      if (item.group && !groups.includes(item.group)) {
        groups.push(item.group);
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
    for (const item of await this.getItems()) {
      for (const tag of item.tags ?? []) {
        if (!tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }
    return tags;
  }

  /**
   * 新增条目（文件夹/文件，按路径去重，一律未分组）。
   *
   * @param uris - 待添加的资源 Uri 列表；与已登记条目 fsPath 相同的会被跳过
   * @returns added 为实际新增数，skipped 为因重复被跳过的数量；无新增时不写盘、不触发 onDidChange
   */
  async add(uris: readonly vscode.Uri[]): Promise<AddItemsResult> {
    const existing = await this.getItems();
    const known = new Set(existing.map((item) => item.path));
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

    await this.commit([...existing, ...added.map((uri) => ({ path: uri.fsPath }))]);
    return { added: added.length, skipped: uris.length - added.length };
  }

  /**
   * 从列表移除指定条目（不影响磁盘文件，其余条目的分组字段保留）。
   *
   * @param uris - 待移除的资源 Uri 列表；未登记的自动忽略
   * @returns 实际移除的条目数；无命中时不写盘、不触发 onDidChange
   */
  async remove(uris: readonly vscode.Uri[]): Promise<number> {
    const existing = await this.getItems();
    const doomed = new Set(uris.map((uri) => uri.fsPath));
    const updated = existing.filter((item) => !doomed.has(item.path));
    if (updated.length === existing.length) {
      return 0;
    }

    await this.commit(updated);
    return existing.length - updated.length;
  }

  /**
   * 批量字段替换的共享实现：命中条目经 patch 生成新对象，patch 对无变化条目必须原样返回，
   * 借对象同一性统计实际变化数；无任何变化时不写盘、不触发刷新。
   *
   * @param uris - 目标条目的 Uri 列表
   * @param patch - 单条目替换函数：入参为原条目，返回新条目（无变化时须返回原对象）
   * @returns 发生变化的条目数
   */
  private async patchItems(
    uris: readonly vscode.Uri[],
    patch: (item: StoredItem) => StoredItem
  ): Promise<number> {
    const items = await this.getItems();
    const targets = new Set(uris.map((uri) => uri.fsPath));
    const updated = items.map((item) => (targets.has(item.path) ? patch(item) : item));

    const changed = updated.filter((item, index) => item !== items[index]).length;
    if (changed === 0) {
      return 0;
    }
    await this.commit(updated);
    return changed;
  }

  /**
   * 设置条目所属分组，同时保留路径和标签等其他元数据。
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
   * 以替换语义设置条目标签集合，同时保留路径和分组等其他元数据。
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
      if (sameTags(item.tags, next)) {
        return item;
      }
      return { ...item, tags: next };
    });
  }

  /**
   * 批量为各条目独立设置标签集合（拖拽等按条目计算结果的场景），normalize/sameTags 规则同 setItemTags。
   *
   * @param updates - 逐条目的更新列表（uri 定位条目，tags 为该条目的新标签集合）
   * @returns 发生变化的条目数；无实际变化时不写盘、不触发 onDidChange
   */
  async applyItemTags(
    updates: readonly ItemTagUpdate[]
  ): Promise<number> {
    const tagsByPath = new Map(updates.map(({ uri, tags }) => [uri.fsPath, tags]));
    return this.patchItems(
      updates.map(({ uri }) => uri),
      (item) => {
        const next = normalizeTags(tagsByPath.get(item.path) ?? []);
        if (sameTags(item.tags, next)) {
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

    const items = await this.getItems();
    let changed = 0;
    const updated = items.map((item) => {
      if (item.group !== oldName) {
        return item;
      }
      changed += 1;
      return { ...item, group: newName };
    });

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
    const items = await this.getItems();
    const changed = items.filter((item) => item.group === name).length;
    if (changed === 0) {
      return 0;
    }
    const updated = items.map((item) => (
      item.group === name ? { ...item, group: undefined } : item
    ));
    await this.commit(updated);
    return changed;
  }

  /**
   * 重命名标签：批量改写所有持有该标签条目的 tags 字段（新名与条目既有标签同名时自然合并去重，保持勾选顺序）。
   *
   * @param oldName - 现标签名
   * @param newName - 新标签名；空白或与现名相同则不处理
   * @returns 改写的条目数；无命中或无变化时不写盘、不触发 onDidChange
   */
  async renameTag(oldName: string, newName: string): Promise<number> {
    if (!newName || oldName === newName) {
      return 0;
    }

    const items = await this.getItems();
    let changed = 0;
    const updated = items.map((item) => {
      if (!item.tags?.includes(oldName)) {
        return item;
      }
      const next = [...new Set(item.tags.map((tag) => (tag === oldName ? newName : tag)))];
      // 条目同时持有新旧两个标签名时改名后集合不变，跳过以免无意义的写盘
      if (sameTags(item.tags, next)) {
        return item;
      }
      changed += 1;
      return { ...item, tags: next };
    });

    if (changed === 0) {
      return 0;
    }
    await this.commit(updated);
    return changed;
  }

  /**
   * 删除标签：从所有持有该标签的条目中移除该标签（条目本身保留），标签随之从派生集合中消失。
   *
   * @param name - 要删除的标签名
   * @returns 改写的条目数；无命中时不写盘、不触发 onDidChange
   */
  async deleteTag(name: string): Promise<number> {
    const items = await this.getItems();
    let changed = 0;
    const updated = items.map((item) => {
      if (!item.tags?.includes(name)) {
        return item;
      }
      changed += 1;
      const next = item.tags.filter((tag) => tag !== name);
      // 命中即必有变化；删除最后一个标签时保留条目的分组等其他元数据
      return { ...item, tags: next.length > 0 ? next : undefined };
    });

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
   * 读取全部条目（内部统一读路径）：优先内存缓存，未加载时读盘一次。
   *
   * @returns 条目数组的浅拷贝（防止调用方直接改动缓存）
   */
  private async getItems(): Promise<StoredItem[]> {
    if (!this.cache) {
      this.cache = await this.read();
    }
    return [...this.cache];
  }

  /**
   * 提交一次变更：写盘、更新缓存、触发视图刷新。
   *
   * @param items - 变更后的完整条目列表
   */
  private async commit(items: StoredItem[]): Promise<void> {
    await this.save(items);
    this.cache = items;
    this._onDidChange.fire();
  }

  /**
   * 从 JSON 文件读取并清洗条目数据（不触碰缓存）。非法顶层结构、非法 items
   * 或缺少绝对路径的条目会被忽略，避免手工编辑配置后破坏整个列表。
   *
   * @returns 清洗后的条目数组；文件不存在时为空数组
   * @throws 内容不是合法 JSON，或发生非 FileNotFound 的读错误时抛出
   */
  private async read(): Promise<StoredItem[]> {
    let content: Uint8Array;
    try {
      content = await vscode.workspace.fs.readFile(this.fileUri);
    } catch (error) {
      // 文件尚未创建时视为空列表
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return [];
      }
      throw error;
    }

    const data = JSON.parse(new TextDecoder().decode(content)) as unknown;
    if (typeof data !== 'object' || data === null) {
      return [];
    }
    const rawItems = (data as RawConfigFileData).items;
    if (!Array.isArray(rawItems)) {
      return [];
    }

    // 边界清洗（手改 JSON 兜底）：group 统一 trim，trim 后为空（空串/纯空白/非字符串）一律视为未分组；
    // tags 逐项 trim、去空、去重；条目必须提供非空绝对路径。下一次 commit 会写回清洗后的数据
    return rawItems.flatMap((rawItem): StoredItem[] => {
      if (typeof rawItem !== 'object' || rawItem === null) {
        return [];
      }
      const item = rawItem as Partial<StoredItem>;
      if (typeof item.path !== 'string' || !path.isAbsolute(item.path)) {
        return [];
      }
      const group = typeof item.group === 'string' ? item.group.trim() : undefined;
      const tags = normalizeTags(Array.isArray(item.tags) ? item.tags : undefined);
      return [{
        path: item.path,
        ...(group ? { group } : {}),
        ...(tags ? { tags } : {}),
      }];
    });
  }

  /**
   * 将条目数组序列化为 JSON 写盘（缩进 2 空格，便于手工编辑与 diff），必要时先创建父目录。
   *
   * @param items - 要写入的完整条目列表
   */
  private async save(items: readonly StoredItem[]): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageDir);
    const data: ConfigFileData = { items: [...items] };
    await vscode.workspace.fs.writeFile(
      this.fileUri,
      new TextEncoder().encode(JSON.stringify(data, null, 2))
    );
  }
}
