import * as vscode from 'vscode';

/** folders.json 的数据结构 */
interface FolderStoreData {
  folders?: string[];
}

/** 以独立的 JSON 文件持久化用户添加的文件夹列表。 */
export class FolderStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private fileUri: vscode.Uri;
  private storageDir: vscode.Uri;
  private cache: vscode.Uri[] | undefined;

  /** @param fileUri folders.json 的完整文件路径 */
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

  /** 获取全部文件夹，首次调用时从 JSON 文件加载。 */
  async getAll(): Promise<vscode.Uri[]> {
    if (!this.cache) {
      this.cache = await this.read();
    }
    return [...this.cache];
  }

  /** 新增文件夹（按路径去重），成功后触发 onDidChange。 */
  async add(uris: readonly vscode.Uri[]): Promise<{ added: number; skipped: number }> {
    const existing = await this.getAll();
    const known = new Set(existing.map((uri) => uri.fsPath));
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

    const updated = [...existing, ...added];
    await this.save(updated);
    this.cache = updated;
    this._onDidChange.fire();
    return { added: added.length, skipped: uris.length - added.length };
  }

  /** 从列表移除指定文件夹（不影响磁盘文件），有实际移除时触发 onDidChange。 */
  async remove(uris: readonly vscode.Uri[]): Promise<number> {
    const existing = await this.getAll();
    const doomed = new Set(uris.map((uri) => uri.fsPath));
    const updated = existing.filter((uri) => !doomed.has(uri.fsPath));
    if (updated.length === existing.length) {
      return 0;
    }

    await this.save(updated);
    this.cache = updated;
    this._onDidChange.fire();
    return existing.length - updated.length;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  private async read(): Promise<vscode.Uri[]> {
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

    const data = JSON.parse(new TextDecoder().decode(content)) as FolderStoreData;
    return (data.folders ?? []).map((path) => vscode.Uri.file(path));
  }

  private async save(folders: readonly vscode.Uri[]): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storageDir);
    const data: FolderStoreData = { folders: folders.map((uri) => uri.fsPath) };
    await vscode.workspace.fs.writeFile(
      this.fileUri,
      new TextEncoder().encode(JSON.stringify(data, null, 2))
    );
  }
}
