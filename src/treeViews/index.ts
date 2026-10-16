import * as vscode from 'vscode';
import { FoldersProvider, VirtualGroupDecorationProvider } from './foldersProvider';
import { isManagedEntry } from './foldersProvider/entries';
import type { Entry } from './foldersProvider/entries';
import { FoldersDragAndDropController } from './foldersProvider/dragAndDrop';
import { inject } from '../services/container';
import { FolderStore } from '../services/folderStore';
import { ViewModeStore } from '../services/viewModeStore';

/** 当前选择是否同时包含已分组和未分组条目的上下文键。 */
const SELECTION_MIXED_KEY = 'folderShelf.selectionMixed';

/** 树视图注册结果。 */
export interface RegisteredViews {
  /** 应加入 `context.subscriptions` 的视图、数据源、监听器和装饰器。 */
  readonly disposables: vscode.Disposable[];
  /** 树数据源。 */
  readonly foldersProvider: FoldersProvider;
  /** 已创建的树视图。 */
  readonly foldersView: vscode.TreeView<Entry>;
}

/**
 * 创建树、数据源和拖放控制器，并注册数据、视图模式和选择变化监听器。
 *
 * @returns 树视图引用及其可释放资源
 */
export function registerTreeViews(): RegisteredViews {
  const folderStore = inject(FolderStore);
  const viewModeStore = inject(ViewModeStore);

  const foldersProvider = new FoldersProvider(folderStore, viewModeStore);

  const foldersView = vscode.window.createTreeView('folderShelf.views.folders', {
    treeDataProvider: foldersProvider,
    canSelectMany: true,
    dragAndDropController: new FoldersDragAndDropController(folderStore),
  });

  // 树数据和视图模式变化都需要重建树节点。
  const refreshSubscription = folderStore.onDidChange(() => {
    foldersProvider.refresh();
  });

  // 视图模式变化需要重建树节点。
  const modeSubscription = viewModeStore.onDidChange(() => {
    foldersProvider.refresh();
  });

  /**
   * 更新选择组成上下文键。内置 `viewItem` 只描述触发菜单的单个条目，无法判断
   * 多选中是否同时包含已分组和未分组条目。
   *
   * @param selection - 当前树选择；非受管理节点会被忽略
   */
  const updateSelectionMixed = (selection: readonly Entry[]): void => {
    const managed = selection.filter(isManagedEntry);
    const mixed =
      managed.some((entry) => entry.group !== undefined) &&
      managed.some((entry) => entry.group === undefined);
    void vscode.commands.executeCommand('setContext', SELECTION_MIXED_KEY, mixed);
  };
  updateSelectionMixed([]);
  const selectionSubscription = foldersView.onDidChangeSelection((event) => {
    updateSelectionMixed(event.selection);
  });

  // 虚拟节点弱化着色，便于与同名的真实分组或标签区分。
  const decorationProvider = vscode.window.registerFileDecorationProvider(new VirtualGroupDecorationProvider());

  return {
    disposables: [foldersView, foldersProvider, refreshSubscription, modeSubscription, selectionSubscription, decorationProvider],
    foldersProvider,
    foldersView,
  };
}
