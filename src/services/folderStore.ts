import * as vscode from 'vscode';
import { ConfigFileError } from './configFileError';
import { itemSchema, rawFileSchema, formatIssues, topLevelErrorKind } from './configSchema';
import type { UsableItem } from './configSchema';
import { itemUriOf, itemPathOf } from '../utils';

/** {@link FolderStore.getAllWithMeta} 返回的条目元数据。 */
export interface ItemMeta {
  /** 条目对应的资源 URI。 */
  readonly uri: vscode.Uri;
  /** 所属分组名；`undefined` 表示未分组。 */
  readonly group?: string;
  /** 标签列表；`undefined` 表示无标签。 */
  readonly tags?: string[];
}

/** 新增条目的统计结果。 */
export interface AddItemsResult {
  /** 实际写入存储的新条目数，不小于 0。 */
  readonly added: number;
  /** 因 URI 重复而跳过的条目数，不小于 0。 */
  readonly skipped: number;
}

/** 单个条目的标签替换请求。 */
export interface ItemTagUpdate {
  /** 待更新条目的资源 URI。 */
  readonly uri: vscode.Uri;
  /** 替换后的完整标签集合；空数组表示清除全部标签。 */
  readonly tags: readonly string[];
}

/** 无法渲染的原始条目及其校验错误。 */
export interface InvalidItemNote {
  /** 未通过 {@link itemSchema} 校验的原始条目。 */
  readonly item: unknown;
  /** 供树视图显示的 Zod 问题文本。 */
  readonly issue: string;
}

/**
 * `config.json` 的内存快照。`top` 保留顶层未知字段；`items` 同时保存已解析条目和
 * 校验失败的原始值，以便写回时保持用户数据不变。
 */
interface RawConfigFile {
  readonly top: Record<string, unknown>;
  readonly items: readonly unknown[];
  readonly invalidNotes: ReadonlyArray<InvalidItemNote>;
}

/**
 * 清理待写入的标签：去除首尾空白、空值和重复项。读取配置时不调用本函数，
 * 避免在用户未编辑标签时改写原始数据。
 *
 * @param tags - 原始标签集合；可含非字符串值
 * @returns 保持首次出现顺序的非空标签数组；无有效标签时为 `undefined`
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
 * 按顺序比较两个标签集合。
 *
 * @param a - 第一个标签集合
 * @param b - 第二个标签集合
 * @returns 两者均为 `undefined`，或长度和每一项都相同时为 `true`
 */
function sameTags(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

/**
 * 从原始条目读取可用的 `path` 字段。
 *
 * @param raw - 原始条目或已解析条目
 * @returns 非空路径；条目无效时为 `undefined`
 */
function usablePath(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>).path;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 将配置中的路径转换为稳定的 URI 字符串，用于匹配和去重。本地路径和完整 URI
 * 都先经过 {@link itemUriOf} 规范化。
 *
 * @param p - 配置条目的路径
 * @returns 与树节点 `uri.toString()` 格式一致的匹配键
 */
function keyOf(p: string): string {
  return itemUriOf(p).toString();
}

/**
 * 从原始条目读取分组名；非字符串值按未分组处理。
 *
 * @param raw - 原始条目或已解析条目
 * @returns 分组名；字段无效时为 `undefined`
 */
function groupOf(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>).group;
  return typeof value === 'string' ? value : undefined;
}

/**
 * 从原始条目读取未经清理的标签数组。
 *
 * @param raw - 原始条目或已解析条目
 * @returns 原始标签数组；字段不是数组时为 `undefined`
 */
function rawTagsOf(raw: unknown): readonly unknown[] | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>).tags;
  return Array.isArray(value) ? value : undefined;
}

/**
 * 生成用于显示的标签列表，不修改配置文件中的原始值。
 *
 * @param tags - 原始标签数组
 * @returns 仅含字符串的标签数组；结果为空时为 `undefined`
 */
function displayTags(tags: readonly unknown[] | undefined): string[] | undefined {
  const cleaned = (tags ?? []).filter((tag): tag is string => typeof tag === 'string');
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * 判断条目的原始标签是否与待写入标签完全相同。原始数组含非字符串值时返回
 * `false`，使显式标签更新同时清理这些无效值。
 *
 * @param item - 已通过基础校验的配置条目
 * @param next - 规范化后的新标签集合
 * @returns 原始标签已是目标值时为 `true`
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
 * 在独立 JSON 文件中保存用户登记的文件和目录。读取结果会缓存；配置文件损坏时，
 * 同一个 {@link ConfigFileError} 会持续抛出，直到刷新或切换文件，从而阻止写操作覆盖
 * 损坏内容。写入时保留顶层未知字段、条目未知字段和无效条目。
 */
export class FolderStore implements vscode.Disposable {
  /** 成功提交数据后触发的事件发射器。 */
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** 供树视图订阅的数据变更事件。 */
  readonly onDidChange = this._onDidChange.event;

  /** 当前配置文件的 URI。 */
  private fileUri: vscode.Uri;
  /** 当前配置文件所在的目录。 */
  private storageDir: vscode.Uri;
  /** 配置文件快照；`undefined` 表示尚未加载。 */
  private cache: RawConfigFile | undefined;
  /** 最近一次读取错误；刷新或切换配置文件时清除。 */
  private readError: ConfigFileError | undefined;

  /**
   * 创建使用指定配置文件的树存储。
   *
   * @param fileUri - 配置文件的绝对 URI
   */
  constructor(fileUri: vscode.Uri) {
    this.fileUri = fileUri;
    this.storageDir = vscode.Uri.joinPath(fileUri, '..');
  }

  /**
   * 切换配置文件，清除缓存并通知订阅者重新加载。
   *
   * @param fileUri - 新配置文件的绝对 URI；路径未变化时忽略
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
   * 丢弃缓存并通知订阅者刷新，使下次读取重新访问配置文件。
   */
  refresh(): void {
    this.cache = undefined;
    this.readError = undefined;
    this._onDidChange.fire();
  }

  /**
   * 获取当前持久化文件的位置。
   *
   * @returns 当前配置文件的绝对 URI
   */
  get file(): vscode.Uri {
    return this.fileUri;
  }

  /**
   * 确保配置文件存在；缺失时创建父目录并写入当前缓存或空列表。
   *
   * @returns 表示文件已存在或已创建的 Promise
   */
  async ensureFile(): Promise<void> {
    try {
      await vscode.workspace.fs.stat(this.fileUri);
    } catch (error) {
      // 仅在文件不存在时创建；权限等错误继续抛出。
      if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
        throw error;
      }
      await this.save(this.cache?.items ?? []);
    }
  }

  /**
   * 获取全部有效的登记条目，首次调用时从配置文件加载。
   *
   * @returns 按登记顺序排列的资源 URI；不含无效条目
   */
  async getAll(): Promise<vscode.Uri[]> {
    const items = await this.getRawItems();
    return items.flatMap((item) => {
      const p = usablePath(item);
      return p === undefined ? [] : [itemUriOf(p)];
    });
  }

  /**
   * 获取树视图所需的有效条目及其分组和标签。
   *
   * @returns 按登记顺序排列的条目元数据；不含无效条目
   */
  async getAllWithMeta(): Promise<ItemMeta[]> {
    const items = await this.getRawItems();
    return items.flatMap((item): ItemMeta[] => {
      const p = usablePath(item);
      if (p === undefined) {
        return [];
      }
      return [{
        uri: itemUriOf(p),
        group: groupOf(item),
        tags: displayTags(rawTagsOf(item)),
      }];
    });
  }

  /**
   * 从条目中提取分组名，并按首次出现顺序去重。分组名不单独持久化，
   * 没有成员的分组不会出现在结果中。
   *
   * @returns 去重后的分组名数组
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
   * 从条目中提取标签名，并按首次出现顺序去重。标签名不单独持久化。
   *
   * @returns 去重后的标签名数组
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
   * 获取当前快照中无法渲染的条目及其校验错误。
   *
   * @returns 无效条目列表；尚未成功加载时为空
   */
  getInvalidNotes(): ReadonlyArray<InvalidItemNote> {
    return this.cache?.invalidNotes ?? [];
  }

  /**
   * 添加文件或目录，并按规范化 URI 去重。新条目不设置分组和标签。
   *
   * @param uris - 待添加的资源 URI；重复项会被跳过
   * @returns 新增数和因重复而跳过的数量；无新增时不写入文件
   */
  async add(uris: readonly vscode.Uri[]): Promise<AddItemsResult> {
    const items = await this.getRawItems();
    const known = new Set(items.flatMap((item) => {
      const p = usablePath(item);
      return p === undefined ? [] : [keyOf(p)];
    }));
    const added: vscode.Uri[] = [];
    for (const uri of uris) {
      if (known.has(uri.toString())) {
        continue;
      }
      known.add(uri.toString());
      added.push(uri);
    }

    if (added.length === 0) {
      return { added: 0, skipped: uris.length };
    }

    await this.commit([...items, ...added.map((uri) => ({ path: itemPathOf(uri) }))]);
    return { added: added.length, skipped: uris.length - added.length };
  }

  /**
   * 从列表移除指定条目，不删除磁盘资源。无效条目原样保留。
   *
   * @param uris - 待移除的资源 URI；未登记的 URI 会被忽略
   * @returns 实际移除的条目数；无匹配项时不写入文件
   */
  async remove(uris: readonly vscode.Uri[]): Promise<number> {
    const items = await this.getRawItems();
    const doomed = new Set(uris.map((uri) => uri.toString()));
    const updated = items.filter((item) => {
      const p = usablePath(item);
      return p === undefined || !doomed.has(keyOf(p));
    });
    if (updated.length === items.length) {
      return 0;
    }

    await this.commit(updated);
    return items.length - updated.length;
  }

  /**
   * 批量更新指定条目。`patch` 必须为未变化的条目返回原对象，本方法据此统计
   * 变化数量并避免无效写入；校验失败的条目不会交给回调。
   *
   * @param uris - 目标条目的资源 URI
   * @param patch - 条目更新函数；无变化时必须返回原对象
   * @returns 实际发生变化的条目数
   */
  private async patchItems(
    uris: readonly vscode.Uri[],
    patch: (item: UsableItem) => UsableItem
  ): Promise<number> {
    const items = await this.getRawItems();
    const targets = new Set(uris.map((uri) => uri.toString()));
    const updated = items.map((item) => {
      const p = usablePath(item);
      return p !== undefined && targets.has(keyOf(p)) ? patch(item as UsableItem) : item;
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
   * @param uris - 目标条目的资源 URI
   * @param group - 目标分组名；`undefined` 表示移出分组
   * @returns 实际发生变化的条目数
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
   * 替换条目的完整标签集合，同时保留路径、分组和未知字段。
   *
   * @param uris - 目标条目的资源 URI
   * @param tags - 新标签集合；`undefined` 或空数组表示清空标签
   * @returns 实际发生变化的条目数
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
   * 批量替换多个条目的标签，每个条目可使用不同的标签集合。
   *
   * @param updates - 按 URI 定位的标签更新列表
   * @returns 实际发生变化的条目数
   */
  async applyItemTags(
    updates: readonly ItemTagUpdate[]
  ): Promise<number> {
    const tagsByPath = new Map(updates.map(({ uri, tags }) => [uri.toString(), tags]));
    return this.patchItems(
      updates.map(({ uri }) => uri),
      (item) => {
        const next = normalizeTags(tagsByPath.get(keyOf(item.path)) ?? []);
        if (sameItemTags(item, next)) {
          return item;
        }
        return { ...item, tags: next };
      }
    );
  }

  /**
   * 重命名分组，并更新该分组的所有成员。
   *
   * @param oldName - 当前分组名
   * @param newName - 新分组名；空字符串或与当前名称相同时不处理
   * @returns 实际更新的条目数
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
   * 解散分组，使其中的条目变为未分组并保留其他字段。
   *
   * @param name - 要解散的分组名
   * @returns 移出该分组的条目数
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
   * 重命名标签，并更新所有使用该标签的条目。若新名称已存在于同一条目，
   * 合并后只保留一个；其他值保持原样。
   *
   * @param oldName - 当前标签名
   * @param newName - 新标签名；空字符串或与当前名称相同时不处理
   * @returns 实际更新的条目数
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
   * 从所有条目中删除指定标签，保留条目和其他标签。
   *
   * @param name - 要删除的标签名
   * @returns 实际更新的条目数
   */
  async deleteTag(name: string): Promise<number> {
    const items = await this.getRawItems();
    const updated = items.map((item) => {
      const tags = rawTagsOf(item);
      if (!tags?.includes(name)) {
        return item;
      }
      const next = tags.filter((tag) => tag !== name);
      // 删除最后一个标签时只移除 `tags`，保留条目的其他字段。
      return { ...(item as UsableItem), tags: next.length > 0 ? next : undefined };
    });

    const changed = updated.filter((item, index) => item !== items[index]).length;
    if (changed === 0) {
      return 0;
    }
    await this.commit(updated);
    return changed;
  }

  /** 释放数据变更事件发射器。 */
  dispose(): void {
    this._onDidChange.dispose();
  }

  /**
   * 从缓存或配置文件读取原始条目。配置解析失败后会重复抛出同一个错误，
   * 直到调用 {@link refresh} 或 {@link setFile}。
   *
   * @returns 已解析条目和校验失败原始值组成的数组
   * @throws {ConfigFileError} JSON 语法或顶层结构无效时抛出
   * @throws 配置文件读取失败且原因不是文件不存在时，原样抛出底层错误
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
   * 保存完整条目数组，更新内存快照并通知订阅者。
   *
   * @param items - 包含有效条目和原始无效值的完整数组
   * @returns 表示数据已保存且变更事件已发出的 Promise
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
   * 读取并校验配置文件，但不更新缓存或修改文件。无效条目保留原值，并在
   * `invalidNotes` 中记录原因。
   *
   * @returns 配置快照；文件不存在时返回空快照
   * @throws {ConfigFileError} JSON 语法或顶层结构无效时抛出
   * @throws 配置文件读取失败且原因不是文件不存在时，原样抛出底层错误
   */
  private async read(): Promise<RawConfigFile> {
    let content: Uint8Array;
    try {
      content = await vscode.workspace.fs.readFile(this.fileUri);
    } catch (error) {
      // 尚未创建配置文件时按空配置处理。
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return { top: {}, items: [], invalidNotes: [] };
      }
      throw error;
    }

    // `JSON.parse` 不接受 UTF-8 BOM，解析前将其移除。
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

    // 有效条目保存解析结果；无效条目保存原值，确保后续写回不会丢失用户内容。
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
   * 创建父目录，并将条目数组以两空格缩进写入 JSON。顶层未知字段保持不变。
   *
   * @param items - 要写入的完整条目数组
   * @returns 表示文件写入完成的 Promise
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
