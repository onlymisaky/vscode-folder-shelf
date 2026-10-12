import * as vscode from 'vscode';
import { ADD_ITEM_COMMAND, OPEN_FILE_COMMAND } from '../../commands';
import { FolderStore } from '../../services/folderStore';
import { ViewMode, ViewModeStore } from '../../services/viewModeStore';
import { GROUP_ICON, TAG_ICON, toNodeEntry } from './entries';
import type { Entry, NodeEntry } from './entries';
import { FlatRootBuilder, GroupedRootBuilder, TaggedRootBuilder } from './rootBuilders';
import type { RootBuilder } from './rootBuilders';

/**
 * 「未分组」「未加标签」虚拟节点专用 scheme：仅用于挂 FileDecorationProvider 实现整体弱化着色，
 * 不对应磁盘资源。真实分组或标签允许与虚拟节点同名，通过装饰颜色、徽标和提示文本区分。
 */
export const UNGROUPED_SCHEME = 'folderShelf-ungrouped';
export const UNTAGGED_SCHEME = 'folderShelf-untagged';

/** 「未分组」虚拟节点挂装饰用的固定资源 Uri（scheme 见 {@link UNGROUPED_SCHEME}） */
const UNGROUPED_RESOURCE = vscode.Uri.from({ scheme: UNGROUPED_SCHEME, path: '/ungrouped' });
/** 「未加标签」虚拟节点挂装饰用的固定资源 Uri（scheme 见 {@link UNTAGGED_SCHEME}） */
const UNTAGGED_RESOURCE = vscode.Uri.from({ scheme: UNTAGGED_SCHEME, path: '/untagged' });

/** 虚拟节点行尾 badge 字符：∅ 表达「不属于任何分组/标签」，语言中立且比符号 - 更醒目 */
const VIRTUAL_BADGE = '∅';

/**
 * 收藏树数据源：按展示模式（平铺/标签/分组）构造根层级，
 * 负责各层级条目 → TreeItem 的渲染。虚拟节点（占位/失效/分组/未分组/标签/未加标签）
 * 与磁盘节点统一以 Entry 建模，渲染与菜单按 kind 判别收窄。
 */
export class FoldersProvider implements vscode.TreeDataProvider<Entry> {
  /** 树数据变更事件发射器（整体刷新时以 undefined 触发） */
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Entry | undefined>();
  /** 树数据变更事件（VSCode 树视图订阅；外部经 refresh 触发） */
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** 根层级构建策略表：按当前展示模式选取（Record 保证新增模式时编译期强制补齐） */
  private readonly rootBuilders: Record<ViewMode, RootBuilder>;

  /**
   * 创建收藏树数据源及各展示模式的根节点构建器。
   *
   * @param folderStore - 收藏列表存储服务
   * @param viewModeStore - 当前展示模式存储
   */
  constructor(
    private readonly folderStore: FolderStore,
    private readonly viewModeStore: ViewModeStore
  ) {
    this.rootBuilders = {
      flat: new FlatRootBuilder(folderStore),
      tagged: new TaggedRootBuilder(folderStore),
      grouped: new GroupedRootBuilder(folderStore),
    };
  }

  /** 通知树整体刷新（fire(undefined)）：数据或展示模式变更后由外部调用。 */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /** 释放事件发射器（扩展停用时由 context.subscriptions 统一调用）。 */
  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  /**
   * 将树条目渲染为 TreeItem。
   * VSCode 渲染时序：先 getChildren 建树，后对每个元素调用本方法。
   *
   * @param element - 待渲染的树条目
   * @returns 对应的 TreeItem（含图标、折叠态、contextValue、单击命令等）
   */
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
    // 真实分组允许使用相同名称，通过禁用色、badge「∅」和 tooltip 区分
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

    // 标签节点：虚拟条目，不设 resourceUri（非磁盘路径），用标签图标区别于真实文件夹
    if (element.kind === 'tag') {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon(TAG_ICON);
      item.contextValue = 'folders.tag';
      return item;
    }

    // 「未加标签」虚拟分组：展示与处理逻辑同「未分组」一致（弱化着色 + badge「∅」+ tooltip），
    // 图标用标签样式；不设 contextValue（不提供标签管理菜单）
    if (element.kind === 'untagged') {
      const item = new vscode.TreeItem(
        vscode.l10n.t('Untagged'),
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.resourceUri = UNTAGGED_RESOURCE;
      item.iconPath = new vscode.ThemeIcon(TAG_ICON);
      item.tooltip = vscode.l10n.t('Virtual group collecting items without any tag.');
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
      // 已分组/已加标签条目依次追加 .grouped/.tagged 后缀，供「移出分组」「管理标签」等菜单做 when 过滤
      item.contextValue = element.group
        ? `${base}.grouped${element.tags?.length ? '.tagged' : ''}`
        : `${base}${element.tags?.length ? '.tagged' : ''}`;
    }

    return item;
  }

  /**
   * 获取当前展示模式对应的根层级构建策略。
   *
   * @returns 与当前 ViewMode 匹配的根节点构建器
   */
  private get rootBuilder(): RootBuilder {
    return this.rootBuilders[this.viewModeStore.mode];
  }

  /**
   * 获取指定条目的子层级；根层级（element 为 undefined）按当前展示模式分派给对应 RootBuilder。
   * VSCode 渲染时序：先本方法建树，后 getTreeItem 渲染。
   *
   * @param element - 父条目；undefined 表示根层级
   * @returns 子条目列表；空列表的根层级返回占位条目，失效目录返回失效占位条目
   */
  async getChildren(element?: Entry): Promise<Entry[]> {
    // 根层级：按展示模式选择构建策略；结果为空时给出占位提示
    if (!element) {
      const entries = await this.rootBuilder.buildRoot();
      return entries.length > 0 ? entries : [{ kind: 'placeholder' }];
    }

    // 分组子层级：该组名下的登记条目（组由条目派生，必有成员）
    if (element.kind === 'group') {
      const items = await this.folderStore.getAllWithMeta();
      return Promise.all(
        items
          .filter((item) => item.group === element.name)
          .map((item) => toNodeEntry(item.uri, item.group, item.tags))
      );
    }

    // 「未分组」子层级：所有未设置 group 的条目
    if (element.kind === 'ungrouped') {
      const items = await this.folderStore.getAllWithMeta();
      return Promise.all(
        items
          .filter((item) => !item.group)
          .map((item) => toNodeEntry(item.uri, undefined, item.tags))
      );
    }

    // 标签子层级：挂有该标签的条目（同一条目可出现在多个标签节点下）。
    // underTag 记录渲染所在的标签组，随拖拽传出供 handleDrop 判定「从哪个标签组拖出」
    if (element.kind === 'tag') {
      const items = await this.folderStore.getAllWithMeta();
      return Promise.all(
        items
          .filter((item) => item.tags?.includes(element.name))
          .map((item) => toNodeEntry(item.uri, item.group, item.tags, element.name))
      );
    }

    // 「未加标签」子层级：所有无标签条目
    if (element.kind === 'untagged') {
      const items = await this.folderStore.getAllWithMeta();
      return Promise.all(
        items
          .filter((item) => !item.tags?.length)
          .map((item) => toNodeEntry(item.uri, item.group, item.tags))
      );
    }

    // 占位条目为叶子，无子层级
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

    // 目录在前、文件在后，同类型按路径字典序排列
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

/** 虚拟节点（「未分组」「未加标签」）装饰：整行（label+图标）使用禁用前景色（比 deemphasized 更浅）+ 行尾 badge「∅」，与同名真实分组/标签区分 */
export class VirtualGroupDecorationProvider implements vscode.FileDecorationProvider {
  /**
   * 为虚拟节点 Uri 提供弱化装饰；其余 Uri 不装饰。
   *
   * @param uri - 待装饰的资源 Uri
   * @returns 虚拟节点 scheme 对应的 FileDecoration（badge「∅」+ 禁用前景色）；非虚拟节点返回 undefined
   */
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme === UNGROUPED_SCHEME || uri.scheme === UNTAGGED_SCHEME) {
      return new vscode.FileDecoration(
        VIRTUAL_BADGE,
        undefined,
        new vscode.ThemeColor('disabledForeground')
      );
    }
    return undefined;
  }
}
