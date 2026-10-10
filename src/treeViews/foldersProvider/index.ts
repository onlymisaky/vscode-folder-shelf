import * as vscode from 'vscode';
import { ADD_ITEM_COMMAND, OPEN_FILE_COMMAND } from '../../commands';
import { FolderStore } from '../../services/folderStore';
import { ViewMode, ViewModeStore } from '../../services/viewModeStore';
import { GROUP_ICON, toNodeEntry } from './entries';
import type { Entry, NodeEntry } from './entries';
import { FlatRootBuilder, GroupedRootBuilder } from './rootBuilders';
import type { RootBuilder } from './rootBuilders';

/**
 * 「未分组」虚拟节点专用 scheme：仅用于挂 FileDecorationProvider 实现整体弱化着色，不对应磁盘资源。
 * 不保留任何名称——真实分组允许与虚拟节点同名，靠颜色深浅区分。
 */
export const UNGROUPED_SCHEME = 'folderShelf-ungrouped';

const UNGROUPED_RESOURCE = vscode.Uri.from({ scheme: UNGROUPED_SCHEME, path: '/ungrouped' });

/** 「未分组」虚拟节点行尾 badge 字符：∅ 表达「不属于任何分组」，语言中立且比符号 - 更醒目 */
const UNGROUPED_BADGE = '∅';

export class FoldersProvider implements vscode.TreeDataProvider<Entry> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Entry | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** 根层级构建策略表：按当前展示模式选取（Record 保证新增模式时编译期强制补齐） */
  private readonly rootBuilders: Record<ViewMode, RootBuilder>;

  constructor(
    private readonly folderStore: FolderStore,
    private readonly viewModeStore: ViewModeStore
  ) {
    this.rootBuilders = {
      flat: new FlatRootBuilder(folderStore),
      grouped: new GroupedRootBuilder(folderStore),
    };
  }

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

    // 分组节点：虚拟条目，不设 resourceUri（非磁盘路径），用独立图标区别于真实文件夹
    if (element.kind === 'group') {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon(GROUP_ICON);
      item.contextValue = 'folders.group';
      return item;
    }

    // 「未分组」虚拟分组：不设 contextValue（不提供重命名/解散等分组菜单）；
    // 不保留任何名称，真实分组允许同名，靠更浅的禁用色 + badge「∅」（UngroupedDecorationProvider）+ tooltip 区分
    if (element.kind === 'ungrouped') {
      const item = new vscode.TreeItem(
        vscode.l10n.t('Ungrouped'),
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.resourceUri = UNGROUPED_RESOURCE;
      item.iconPath = new vscode.ThemeIcon(GROUP_ICON);
      item.tooltip = vscode.l10n.t('Virtual group collecting items not assigned to any group.');
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
      const base = isDirectory ? 'folders.folder' : 'folders.file';
      // 已分组条目追加 .grouped 后缀，供「移出分组」等菜单做 when 过滤
      item.contextValue = element.group ? `${base}.grouped` : base;
    }

    return item;
  }

  private get rootBuilder(): RootBuilder {
    return this.rootBuilders[this.viewModeStore.mode];
  }

  // 先执行
  async getChildren(element?: Entry): Promise<Entry[]> {
    // 根层级：按展示模式选择构建策略；结果为空时给出占位提示
    if (!element) {
      const entries = await this.rootBuilder.buildRoot();
      return entries.length > 0 ? entries : [{ kind: 'placeholder' }];
    }

    // 分组子层级：该组名下的登记条目（组由条目派生，必有成员）
    if (element.kind === 'group') {
      const items = await this.folderStore.getAllWithGroups();
      return Promise.all(
        items
          .filter((item) => item.group === element.name)
          .map((item) => toNodeEntry(item.uri, item.group))
      );
    }

    // 「未分组」子层级：所有未分组（含悬空 group）条目
    if (element.kind === 'ungrouped') {
      const [items, groups] = await Promise.all([
        this.folderStore.getAllWithGroups(),
        this.folderStore.getGroups(),
      ]);
      const known = new Set(groups);
      return Promise.all(
        items
          .filter((item) => !item.group || !known.has(item.group))
          .map((item) => toNodeEntry(item.uri))
      );
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

/** 「未分组」虚拟节点装饰：整行（label+图标）使用禁用前景色（比 deemphasized 更浅）+ 行尾 badge「∅」，与同名真实分组区分 */
export class UngroupedDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme === UNGROUPED_SCHEME) {
      return new vscode.FileDecoration(
        UNGROUPED_BADGE,
        undefined,
        new vscode.ThemeColor('disabledForeground')
      );
    }
    return undefined;
  }
}
