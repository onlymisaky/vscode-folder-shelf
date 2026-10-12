import * as vscode from 'vscode';
import { FoldersProvider, VirtualGroupDecorationProvider } from './foldersProvider';
import { isManagedEntry } from './foldersProvider/entries';
import type { Entry } from './foldersProvider/entries';
import { FoldersDragAndDropController } from './foldersProvider/dragAndDrop';
import { inject } from '../services/container';
import { FolderStore } from '../services/folderStore';
import { ViewModeStore } from '../services/viewModeStore';

/** 自定义 context key：selection 是否同时含已分组与未分组条目（供菜单 when 感知 selection 组成成分），值恒为 boolean */
const SELECTION_MIXED_KEY = 'folderShelf.selectionMixed';

/** registerTreeViews 的返回值：视图相关的可释放对象与对外引用 */
export interface RegisteredViews {
  /** 全部需挂到 context.subscriptions 的可释放对象（视图、Provider、事件订阅、装饰器） */
  readonly disposables: vscode.Disposable[];
  /** 树数据 Provider 实例（供组合根或后续扩展引用） */
  readonly foldersProvider: FoldersProvider;
  /** 创建后的树视图句柄，供调用方读取选择状态或注册后续交互 */
  readonly foldersView: vscode.TreeView<Entry>;
}

/**
 * 树视图组合根：创建收藏树 Provider、TreeView 与拖拽控制器，
 * 并订阅数据变更、展示模式切换、selection 变更三类事件维护视图状态。
 *
 * @returns 视图句柄集合（含需统一释放的 disposables）
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

  // 数据变更（如新增文件夹）时刷新视图
  const refreshSubscription = folderStore.onDidChange(() => {
    foldersProvider.refresh();
  });

  // 展示模式切换（平铺/分组）时刷新根层级
  const modeSubscription = viewModeStore.onDidChange(() => {
    foldersProvider.refresh();
  });

  /**
   * 将当前选择是否混合包含已分组和未分组条目写入自定义上下文键。
   * viewItem 只反映单条目，内置键无法区分「多选全已分组」与「混选」；右键前的选择事件
   * 先于菜单条件求值，因此在此同步后，菜单的 when 子句始终能读取到最新组成状态。
   *
   * @param selection - 当前树选择；非登记节点会被忽略
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

  // 「未分组」「未加标签」虚拟节点弱化着色（与同名真实分组/标签区分）
  const decorationProvider = vscode.window.registerFileDecorationProvider(new VirtualGroupDecorationProvider());

  return {
    disposables: [foldersView, foldersProvider, refreshSubscription, modeSubscription, selectionSubscription, decorationProvider],
    foldersProvider,
    foldersView,
  };
}
