import * as vscode from 'vscode';
import { FoldersProvider, Entry } from './foldersProvider';
import { inject } from '../services/container';
import { FolderStore } from '../services/folderStore';

export interface RegisteredViews {
  readonly disposables: vscode.Disposable[];
  readonly foldersProvider: FoldersProvider;
  /** 供组合根传给需要读取 selection 的命令（defineWiredCommand wire 注入） */
  readonly foldersView: vscode.TreeView<Entry>;
}

export function registerTreeViews(): RegisteredViews {
  const folderStore = inject(FolderStore);

  const foldersProvider = new FoldersProvider(folderStore);

  const foldersView = vscode.window.createTreeView('folderShelf.views.folders', {
    treeDataProvider: foldersProvider,
    canSelectMany: true,
  });

  // 数据变更（如新增文件夹）时刷新视图
  const refreshSubscription = folderStore.onDidChange(() => {
    foldersProvider.refresh();
  });

  return {
    disposables: [foldersView, foldersProvider, refreshSubscription],
    foldersProvider,
    foldersView,
  };
}
