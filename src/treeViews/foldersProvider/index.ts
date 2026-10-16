import * as vscode from 'vscode';
import { ConfigFileError } from '../../services/configFileError';
import { FolderStore } from '../../services/folderStore';
import type { ItemMeta } from '../../services/folderStore';
import { ViewMode, ViewModeStore } from '../../services/viewModeStore';
import { isFsAccessible, reportConfigFileError } from '../../utils';
import { UNGROUPED_SCHEME, UNTAGGED_SCHEME, toNodeEntry } from './entries';
import type { Entry, NodeEntry } from './entries';
import { treeItemRenderers } from './renderers';
import { FlatRootBuilder, GroupedRootBuilder, TaggedRootBuilder } from './rootBuilders';
import type { RootBuilder } from './rootBuilders';

/** “未分组”和“未加标签”节点显示的徽标。 */
const VIRTUAL_BADGE = '∅';

export class FoldersProvider implements vscode.TreeDataProvider<Entry> {
  /** 树数据变更事件发射器；整体刷新时传入 `undefined`。 */
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Entry | undefined>();
  /** VS Code 树视图订阅的数据变更事件。 */
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** 各视图模式对应的根节点构建器。 */
  private readonly rootBuilders: Record<ViewMode, RootBuilder>;

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

  /** 通知 VS Code 重新读取整棵树。 */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /** 释放树数据变更事件发射器。 */
  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  /**
   * 根据条目种类调用对应的渲染器。
   *
   * @param element - 待渲染的树条目
   * @returns 包含图标、折叠状态、菜单上下文和命令的树项
   */
  getTreeItem(element: Entry): vscode.TreeItem {
    // TypeScript 无法关联索引键和联合类型成员；Renderers 映射类型已保证表项完整。
    return treeItemRenderers[element.kind](element as never);
  }

  /**
   * 获取根节点或指定条目的子节点。
   *
   * @param element - 父条目；`undefined` 表示树根
   * @returns 子节点；空树或无法读取的目录会返回相应占位项
   */
  async getChildren(element?: Entry): Promise<Entry[]> {
    // 根节点按当前视图模式构造。
    if (!element) {
      return this.buildRootChildren();
    }

    // 分组节点只显示属于该分组的登记条目。
    if (element.kind === 'group') {
      return this.filterChildren((item) => item.group === element.name);
    }

    // “未分组”节点显示没有分组名的条目。
    if (element.kind === 'ungrouped') {
      return this.filterChildren((item) => !item.group);
    }

    // 记录当前标签，使拖放处理能够移除条目被拖出的标签。
    if (element.kind === 'tag') {
      return this.filterChildren(
        (item) => item.tags?.includes(element.name) ?? false,
        element.name
      );
    }

    // “未加标签”节点显示标签列表为空的条目。
    if (element.kind === 'untagged') {
      return this.filterChildren((item) => !item.tags?.length);
    }

    // 文件系统节点从其 URI 读取子节点。
    if (element.kind === 'node') {
      return this.readNodeChildren(element);
    }

    // 其余条目均为没有子节点的占位项。
    return [];
  }

  /**
   * 构造根节点，并在配置无效时返回错误占位项。
   *
   * @returns 根节点；必要时包含空列表、配置错误或无效条目占位项
   */
  private async buildRootChildren(): Promise<Entry[]> {
    let entries: Entry[];
    try {
      entries = await this.rootBuilder.buildRoot();
    } catch (error) {
      if (error instanceof ConfigFileError) {
        // 错误提示不阻塞树构建；错误实例缓存可避免重复弹窗。
        void reportConfigFileError(error);
        return [{ kind: 'configError' }];
      }
      throw error;
    }

    // 无效条目仍保留在配置中，因此用汇总项代替“列表为空”提示。
    const invalidNotes = this.folderStore.getInvalidNotes();
    if (invalidNotes.length > 0) {
      return [
        ...entries,
        {
          kind: 'invalidEntries',
          count: invalidNotes.length,
          issues: invalidNotes.map((note) => note.issue),
        },
      ];
    }
    return entries.length > 0 ? entries : [{ kind: 'placeholder' }];
  }

  /**
   * 筛选登记条目，并转换为虚拟分组或标签节点的子节点。
   *
   * @param matches - 条目筛选函数
   * @param parentTag - 标签模式下当前父标签的名称
   * @returns 匹配的受管理节点
   */
  private async filterChildren(matches: (item: ItemMeta) => boolean, parentTag?: string): Promise<Entry[]> {
    const items = await this.folderStore.getAllWithMeta();
    return Promise.all(
      items
        .filter(matches)
        .map((item) => toNodeEntry(item.uri, item.group, item.tags, parentTag))
    );
  }

  /**
   * 读取磁盘目录的子层级，目录在前、文件在后，同类型按路径字典序排列。
   *
   * @param element - 目录节点
   * @returns 排序后的子节点；目录缺失或不可访问时返回占位项
   */
  private async readNodeChildren(element: NodeEntry): Promise<Entry[]> {
    const parentUri = element.uri;

    // 渲染后远程连接可能变化，因此读取前再次检查访问权限。
    if (!isFsAccessible(parentUri)) {
      return [{ kind: 'unavailable', uri: parentUri }];
    }

    let entries: Array<[string, vscode.FileType]>;

    try {
      entries = await vscode.workspace.fs.readDirectory(parentUri);
    } catch (error) {
      // 文件系统提供程序不可用时显示“不可访问”，不要误判为资源已删除。
      if (error instanceof vscode.FileSystemError && error.code === 'Unavailable') {
        return [{ kind: 'unavailable', uri: parentUri }];
      }
      // 目录被删除或移动后，用局部占位项替代读取错误。
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return [{ kind: 'missing' }];
      }
      throw error;
    }

    // 目录排在文件之前，同类节点按 URI 路径排序。
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

  /**
   * 获取当前展示模式对应的根层级构建策略。
   *
   * @returns 与当前视图模式对应的根节点构建器
   */
  private get rootBuilder(): RootBuilder {
    return this.rootBuilders[this.viewModeStore.mode];
  }
}

/** 虚拟节点颜色弱化、徽标 */
export class VirtualGroupDecorationProvider implements vscode.FileDecorationProvider {
  /**
   * 为虚拟节点 URI 提供弱化装饰。
   *
   * @param uri - 待装饰的资源 URI
   * @returns 虚拟节点的装饰；其他 URI 返回 `undefined`
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
