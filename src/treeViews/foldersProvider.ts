import * as vscode from 'vscode';
import { ADD_ITEM_COMMAND, OPEN_FILE_COMMAND } from '../commands';
import { FolderStore } from '../services/folderStore';

export interface NodeEntry {
  readonly kind: 'node';
  readonly uri: vscode.Uri;
  readonly type: vscode.FileType;
  /** 仅根层级登记的文件夹/文件为 true，用于设置 contextValue 供右键菜单 when 过滤 */
  readonly managed?: true;
}

export interface PlaceholderEntry {
  readonly kind: 'placeholder';
}

/** 目录在磁盘上已不存在时展示的失效占位条目 */
export interface MissingEntry {
  readonly kind: 'missing';
}

export type Entry = NodeEntry | PlaceholderEntry | MissingEntry;

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

  // 后执行
  getTreeItem(element: Entry): vscode.TreeItem {
    // 空列表占位项，点击即添加文件夹/文件
    if (element.kind === 'placeholder') {
      const item = new vscode.TreeItem(
        vscode.l10n.t('No items added yet. Click to add one.'),
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon('add');
      item.command = ADD_ITEM_COMMAND.treeItemCommand(
        vscode.l10n.t('Add')
      );
      return item;
    }

    // 失效占位项：登记的文件夹/文件在磁盘上不存在
    if (element.kind === 'missing') {
      const item = new vscode.TreeItem(
        vscode.l10n.t('Item is missing on disk'),
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon('warning');
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

    // 仅根层级登记的条目标记 contextValue（与 package.json 的 when 子句对应）：
    // 文件夹为 folders.folder（inline 打开项目按钮），文件为 folders.file（单击已绑定打开）。
    // 打开文件夹操作由条目右侧的 inline 图标触发（view/item/context inline group），不绑定行单击命令
    if (element.managed) {
      item.contextValue = isDirectory ? 'folders.folder' : 'folders.file';
    }

    return item;
  }

  // 先执行
  async getChildren(element?: Entry): Promise<Entry[]> {
    // 根层级：返回 JSON 中登记的文件夹/文件；为空时给出占位提示
    if (!element) {
      const items = await this.folderStore.getAll();
      if (items.length === 0) {
        return [{ kind: 'placeholder' }];
      }

      // stat 判定文件/目录类型；失效条目按目录兜底，展开时由 readDirectory 的失效处理展示占位项
      return Promise.all(items.map(async (uri): Promise<Entry> => {
        let type = vscode.FileType.Directory;
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          type = (stat.type & vscode.FileType.Directory) !== 0
            ? vscode.FileType.Directory
            : vscode.FileType.File;
        } catch {
          // stat 失败（已删除/移动）时按目录兜底，保持与既有失效文件夹一致的展示
        }
        return { kind: 'node', uri, type, managed: true };
      }));
    }

    if (element.kind === 'placeholder' || element.kind === 'missing') {
      return [];
    }

    const parentUri = element.uri;
    let entries: Array<[string, vscode.FileType]>;
    
    try {
      entries = await vscode.workspace.fs.readDirectory(parentUri);
    } catch (error) {
      // 目录已被删除/移动时展示失效占位项，而不是让整个树抛错
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return [{ kind: 'missing' }];
      }
      throw error;
    }

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
