import * as vscode from 'vscode';

/** config.json 的数据结构 */
interface ConfigFileData {
  items?: StoredItem[];
}

/** 单个收藏条目：对象结构便于后期扩展字段（如置顶、备注） */
interface StoredItem {
  /** 条目绝对路径 */
  path: string;
  /** 所属分组名；缺省为未分组。分组集合由全部条目的该字段派生（不单独存储 groups） */
  group?: string;
  /** 标签列表（一个条目可属多个标签）；缺省为无标签。标签集合由全部条目的该字段派生（不单独存储） */
  tags?: string[];
}

/** 携带分组与标签信息的条目视图（getAllWithMeta 返回） */
export interface ItemMeta {
  readonly uri: vscode.Uri;
  readonly group?: string;
  readonly tags?: string[];
}

/** 标签集合 normalize：逐个 trim、去空、去重；结果为空视为无标签（undefined）。兼容手改 JSON 的脏元素（非字符串直接丢弃）。 */
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

/** 标签集合逐项比较（顺序敏感，保持用户勾选顺序）；undefined 视为无标签。 */
function sameTags(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

/** 以独立的 JSON 文件持久化用户添加的文件夹/文件列表。 */
export class FolderStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private fileUri: vscode.Uri;
  private storageDir: vscode.Uri;
  private cache: StoredItem[] | undefined;

  /** @param fileUri config.json 的完整文件路径 */
  constructor(fileUri: vscode.Uri) {
    this.fileUri = fileUri;
    this.storageDir = vscode.Uri.joinPath(fileUri, '..');
  }

  /** 切换持久化文件位置（设置变更时调用）：重置缓存并触发刷新，下次 getAll 从新文件加载。 */
  setFile(fileUri: vscode.Uri): void {
    if (fileUri.fsPath === this.fileUri.fsPath) {
      return;
    }
    this.fileUri = fileUri;
    this.storageDir = vscode.Uri.joinPath(fileUri, '..');
    this.cache = undefined;
    this._onDidChange.fire();
  }

  /** 丢弃缓存并触发刷新，下次 getAll 重新从 JSON 文件加载（文件可能在外部被修改）。 */
  refresh(): void {
    this.cache = undefined;
    this._onDidChange.fire();
  }

  /** 当前持久化文件的 Uri（设置变更后随之更新）。 */
  get file(): vscode.Uri {
    return this.fileUri;
  }

  /** 持久化文件不存在时以空骨架创建（含父目录），保证文件可直接打开编辑。 */
  async ensureFile(): Promise<void> {
    try {
      await vscode.workspace.fs.stat(this.fileUri);
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
        throw error;
      }
      await this.save(this.cache ?? []);
    }
  }

  /** 获取全部登记条目（文件夹/文件），首次调用时从 JSON 文件加载。 */
  async getAll(): Promise<vscode.Uri[]> {
    const items = await this.getItems();
    return items.map((item) => vscode.Uri.file(item.path));
  }

  /** 获取全部条目及其分组名、标签列表（树渲染用）。 */
  async getAllWithMeta(): Promise<ItemMeta[]> {
    const items = await this.getItems();
    return items.map((item) => ({
      uri: vscode.Uri.file(item.path),
      group: item.group,
      tags: item.tags,
    }));
  }

  /** 派生的分组名列表：按条目在列表中首次出现的顺序去重。分组仅在仍有成员时存在；不保留任何名称，「未分组」虚拟节点由 Entry kind 标识。 */
  async getGroups(): Promise<string[]> {
    const groups: string[] = [];
    for (const item of await this.getItems()) {
      if (item.group && !groups.includes(item.group)) {
        groups.push(item.group);
      }
    }
    return groups;
  }

  /** 派生的标签列表：按条目在列表中首次出现的顺序去重。标签仅在仍被引用时存在；不保留任何名称。 */
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

  /** 新增条目（文件夹/文件，按路径去重，一律未分组），成功后触发 onDidChange。 */
  async add(uris: readonly vscode.Uri[]): Promise<{ added: number; skipped: number }> {
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

  /** 从列表移除指定条目（不影响磁盘文件，其余条目的分组字段保留），有实际移除时触发 onDidChange。 */
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
   * 借对象同一性统计实际变化数；无任何变化时不写盘、不触发刷新。返回发生变化的条目数。
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

  /** 设置条目所属分组（group 传 undefined 表示移出分组）。无实际变化时不写盘、不触发刷新。 */
  async setItemGroups(uris: readonly vscode.Uri[], group: string | undefined): Promise<number> {
    return this.patchItems(uris, (item) => {
      if (item.group === group) {
        return item;
      }
      return group === undefined ? { path: item.path } : { ...item, group };
    });
  }

  /** 设置条目标签集合（tags 传 undefined 或空集表示清除全部标签，名称统一 trim、去空、去重）。无实际变化时不写盘、不触发刷新。 */
  async setItemTags(
    uris: readonly vscode.Uri[],
    tags: readonly string[] | undefined
  ): Promise<number> {
    const next = normalizeTags(tags);
    return this.patchItems(uris, (item) => {
      if (sameTags(item.tags, next)) {
        return item;
      }
      return next === undefined ? { path: item.path } : { ...item, tags: next };
    });
  }

  /** 批量为各条目独立设置标签集合（拖拽等按条目计算结果的场景），normalize/sameTags 规则同 setItemTags。无实际变化时不写盘、不触发刷新。 */
  async applyItemTags(
    updates: ReadonlyArray<{ uri: vscode.Uri; tags: readonly string[] }>
  ): Promise<number> {
    const tagsByPath = new Map(updates.map(({ uri, tags }) => [uri.fsPath, tags]));
    return this.patchItems(
      updates.map(({ uri }) => uri),
      (item) => {
        const next = normalizeTags(tagsByPath.get(item.path) ?? []);
        if (sameTags(item.tags, next)) {
          return item;
        }
        return next === undefined ? { path: item.path } : { ...item, tags: next };
      }
    );
  }

  /** 重命名分组：批量改写所属条目的 group 字段（组的显示位置随首个成员移动）。 */
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

  /** 解散分组：所属条目回到未分组（条目本身保留），分组随之从派生集合中消失。 */
  async dissolveGroup(name: string): Promise<number> {
    const items = await this.getItems();
    const changed = items.filter((item) => item.group === name).length;
    if (changed === 0) {
      return 0;
    }
    const updated = items.map((item) => (item.group === name ? { path: item.path } : item));
    await this.commit(updated);
    return changed;
  }

  /** 重命名标签：批量改写所有持有该标签条目的 tags 字段（新名与条目既有标签同名时自然合并去重，保持勾选顺序）。 */
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

  /** 删除标签：从所有持有该标签的条目中移除该标签（条目本身保留），标签随之从派生集合中消失。 */
  async deleteTag(name: string): Promise<number> {
    const items = await this.getItems();
    let changed = 0;
    const updated = items.map((item) => {
      if (!item.tags?.includes(name)) {
        return item;
      }
      changed += 1;
      const next = item.tags.filter((tag) => tag !== name);
      // 命中即必有变化（next 比 item.tags 短）；清空视为无标签，与 setItemTags 的展开规则一致
      return next.length > 0 ? { ...item, tags: next } : { path: item.path };
    });

    if (changed === 0) {
      return 0;
    }
    await this.commit(updated);
    return changed;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  private async getItems(): Promise<StoredItem[]> {
    if (!this.cache) {
      this.cache = await this.read();
    }
    return [...this.cache];
  }

  /** 提交一次变更：写盘、更新缓存、触发视图刷新。 */
  private async commit(items: StoredItem[]): Promise<void> {
    await this.save(items);
    this.cache = items;
    this._onDidChange.fire();
  }

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

    const data = JSON.parse(new TextDecoder().decode(content)) as ConfigFileData;
    // 边界清洗（手改 JSON 兜底）：group 统一 trim，trim 后为空（空串/纯空白/非字符串）一律视为未分组；
    // tags 逐项 trim、去空、去重，非字符串元素丢弃，清洗后为空视为无标签。
    // 渲染立即正确；脏值不再被原样保留，下一次任意 commit 写盘时整个文件随之洗净
    return (data.items ?? []).map((item) => {
      const group = typeof item.group === 'string' ? item.group.trim() : undefined;
      const tags = normalizeTags(Array.isArray(item.tags) ? item.tags : undefined);
      return {
        path: item.path,
        ...(group ? { group } : {}),
        ...(tags ? { tags } : {}),
      };
    });
  }

  private async save(items: readonly StoredItem[]): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageDir);
    const data: ConfigFileData = { items: [...items] };
    await vscode.workspace.fs.writeFile(
      this.fileUri,
      new TextEncoder().encode(JSON.stringify(data, null, 2))
    );
  }
}
