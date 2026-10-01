import * as vscode from 'vscode';
import { ADD_FOLDER_COMMAND, OPEN_FILE_COMMAND } from '../commands';
import { FolderStore } from '../services/folderStore';

export interface NodeEntry {
  readonly kind: 'node';
  readonly uri: vscode.Uri;
  readonly type: vscode.FileType;
  /** 仅根层级登记的文件夹为 true，用于设置 contextValue 供右键菜单 when 过滤 */
  readonly managed?: true;
}

export interface PlaceholderEntry {
  readonly kind: 'placeholder';
}

export type Entry = NodeEntry | PlaceholderEntry;

export class FoldersProvider implements vscode.TreeDataProvider<Entry> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Entry | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly folderStore: FolderStore) { }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: Entry): vscode.TreeItem {
    // 空列表占位项，点击即添加文件夹
    if (element.kind === 'placeholder') {
      const item = new vscode.TreeItem(
        vscode.l10n.t('No folders added yet. Click to add one.'),
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon('add');
      item.command = ADD_FOLDER_COMMAND.treeItemCommand(
        vscode.l10n.t('Add Folder')
      );
      return item;
    }

    const isDirectory = element.type === vscode.FileType.Directory;
    const item = new vscode.TreeItem(
      element.uri,
      isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );

    // 文件条目绑定单击命令，实现点击预览
    if (!isDirectory) {
      item.command = OPEN_FILE_COMMAND.treeItemCommand(
        vscode.l10n.t('Open File'),
        element.uri,
      );
    }

    // 仅根层级登记的文件夹标记 contextValue（与 package.json 的 when 子句对应）
    if (element.managed) {
      item.contextValue = 'folders.folder';
    }

    return item;
  }

  async getChildren(element?: Entry): Promise<Entry[]> {
    // 根层级：返回 JSON 中登记的文件夹；为空时给出占位提示
    if (!element) {
      const folders = await this.folderStore.getAll();
      if (folders.length === 0) {
        return [{ kind: 'placeholder' }];
      }
      return folders.map((uri): Entry => ({
        kind: 'node',
        uri,
        type: vscode.FileType.Directory,
        managed: true,
      }));
    }
    if (element.kind === 'placeholder') {
      return [];
    }

    const parentUri = element.uri;
    const entries = await vscode.workspace.fs.readDirectory(parentUri);
    return entries
      .map(([name, type]): NodeEntry => ({
        kind: 'node',
        uri: vscode.Uri.joinPath(parentUri, name),
        type,
      }))
      .sort((a, b) => {
        const aDir = a.type === vscode.FileType.Directory ? 0 : 1;
        const bDir = b.type === vscode.FileType.Directory ? 0 : 1;
        return aDir - bDir || a.uri.path.localeCompare(b.uri.path);
      });
  }
}
