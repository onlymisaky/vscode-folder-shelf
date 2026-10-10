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
}

/** 携带分组信息的条目视图（getAllWithGroups 返回） */
export interface GroupedEntry {
  readonly uri: vscode.Uri;
  readonly group?: string;
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

  /** 获取全部条目及其分组名（分组模式渲染用）。 */
  async getAllWithGroups(): Promise<GroupedEntry[]> {
    const items = await this.getItems();
    return items.map((item) => ({ uri: vscode.Uri.file(item.path), group: item.group }));
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

  /** 设置条目所属分组（group 传 undefined 表示移出分组）。无实际变化时不写盘、不触发刷新。 */
  async setItemGroups(uris: readonly vscode.Uri[], group: string | undefined): Promise<number> {
    const items = await this.getItems();
    const targets = new Set(uris.map((uri) => uri.fsPath));
    let changed = 0;
    const updated = items.map((item) => {
      if (!targets.has(item.path) || item.group === group) {
        return item;
      }
      changed += 1;
      return group === undefined ? { path: item.path } : { ...item, group };
    });

    if (changed === 0) {
      return 0;
    }
    await this.commit(updated);
    return changed;
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
    // 边界清洗（手改 JSON 兜底）：group 统一 trim，trim 后为空（空串/纯空白/非字符串）一律视为未分组。
    // 渲染立即正确；脏值不再被原样保留，下一次任意 commit 写盘时整个文件随之洗净
    return (data.items ?? []).map((item) => {
      const group = typeof item.group === 'string' ? item.group.trim() : undefined;
      return group ? { path: item.path, group } : { path: item.path };
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
