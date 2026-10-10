import * as vscode from 'vscode';
import { FoldersProvider, UngroupedDecorationProvider } from './foldersProvider';
import { isManagedEntry } from './foldersProvider/entries';
import type { Entry } from './foldersProvider/entries';
import { FoldersDragAndDropController } from './foldersProvider/dragAndDrop';
import { inject } from '../services/container';
import { FolderStore } from '../services/folderStore';
import { ViewModeStore } from '../services/viewModeStore';

/** 自定义 context key：selection 是否同时含已分组与未分组条目（供菜单 when 感知 selection 组成成分） */
const SELECTION_MIXED_KEY = 'folderShelf.selectionMixed';

export interface RegisteredViews {
  readonly disposables: vscode.Disposable[];
  readonly foldersProvider: FoldersProvider;
  /** 供组合根传给需要读取 selection 的命令（defineWiredCommand wire 注入） */
  readonly foldersView: vscode.TreeView<Entry>;
}

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

  // 混选状态写入自定义 context key：viewItem 只反映单条目视角，静态内置键（如 listMultiSelection）
  // 无法区分「多选全已分组」与「混选」，唯有携带 selection 组成成分的自定义键能让 when 子句二者兼顾。
  // 右键前必先改选（onDidChangeSelection 先于菜单求值触发），键值天然就绪
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

  // 「未分组」虚拟节点弱化着色（与同名真实分组区分）
  const decorationProvider = vscode.window.registerFileDecorationProvider(new UngroupedDecorationProvider());

  return {
    disposables: [foldersView, foldersProvider, refreshSubscription, modeSubscription, selectionSubscription, decorationProvider],
    foldersProvider,
    foldersView,
  };
}
