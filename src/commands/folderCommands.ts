import * as vscode from 'vscode';
import * as path from 'node:path';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';
import type { Entry, NodeEntry } from '../treeViews/foldersProvider';

/** 加入列表并提示被跳过的重复项（addFolder 与「添加当前项目」共用）。 */
async function addAndReportSkipped(
  folderStore: FolderStore,
  uris: readonly vscode.Uri[]
): Promise<void> {
  const { skipped } = await folderStore.add(uris);
  if (skipped > 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('{0} folder(s) already in the list and were skipped.', skipped)
    );
  }
}

export const ADD_FOLDER_COMMAND = defineCommand('folderShelf.addFolder', async () => {
  const folderStore = inject(FolderStore);

  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: true,
    openLabel: vscode.l10n.t('Add Folder'),
    title: vscode.l10n.t('Select Folders to Add'),
  });

  if (!uris || uris.length === 0) {
    return;
  }

  await addAndReportSkipped(folderStore, uris);
})

/**
 * 将当前窗口打开的项目加入列表（多根工作区取全部根文件夹）。
 * 由视图标题栏按钮或命令面板触发；过滤掉 untitled 等非磁盘目录。
 */
export const ADD_CURRENT_PROJECT_COMMAND = defineCommand(
  'folderShelf.addCurrentProject',
  async (): Promise<void> => {
    const folderStore = inject(FolderStore);

    const uris = (vscode.workspace.workspaceFolders ?? [])
      .map((folder) => folder.uri)
      .filter((uri) => uri.scheme === 'file');

    if (uris.length === 0) {
      await vscode.window.showInformationMessage(
        vscode.l10n.t('No folder is currently open.')
      );
      return;
    }

    await addAndReportSkipped(folderStore, uris);
  }
);

/**
 * 一键折叠视图中的全部目录。
 * VSCode 会为每个 createTreeView 注册内部命令
 * `workbench.actions.treeView.<viewId>.collapseAll`，直接转发即可。
 */
export const COLLAPSE_ALL_COMMAND = defineCommand('folderShelf.collapseAll', async () => {
  await vscode.commands.executeCommand(
    'workbench.actions.treeView.folderShelf.views.folders.collapseAll'
  );
});

/**
 * 判断菜单/inline 回传参数是否为登记的根文件夹元素。
 * 实测（Trae CN，VSCode 分支同源）：view/item/context 与 inline 菜单回传的是
 * getChildren 返回的元素本身（Entry），而非 TreeItem，故直接按类型收窄。
 */
function isManagedEntry(value: unknown): value is NodeEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as NodeEntry).kind === 'node' &&
    (value as NodeEntry).managed === true
  );
}

/**
 * 从菜单/inline 图标回传的参数解析目标（登记的根文件夹），按 fsPath 去重。
 * 实测：回传的是 getChildren 返回的元素本身（Entry），而非 TreeItem；
 * 多选时第二参数为 selection 数组。两个命令均仅从菜单触发，参数恒有值。
 */
function collectManagedUris(item?: Entry, selectedItems?: readonly Entry[]): vscode.Uri[] {
  const uris = new Map<string, vscode.Uri>();
  for (const raw of [item, ...(selectedItems ?? [])]) {
    if (isManagedEntry(raw)) {
      uris.set(raw.uri.fsPath, raw.uri);
    }
  }
  return [...uris.values()];
}

/**
 * 移除文件夹：从树条目右键菜单触发，仅从列表移除（不影响磁盘文件）。
 * 目标从菜单回传参数解析（多选时 VSCode 回传 (item, selectedItems)）。
 */
export const REMOVE_FOLDER_COMMAND = defineCommand(
  'folderShelf.removeFolder',
  async (item?: Entry, selectedItems?: readonly Entry[]): Promise<void> => {
    const folderStore = inject(FolderStore);

    const targets = collectManagedUris(item, selectedItems);
    if (targets.length === 0) {
      return;
    }

    const REMOVE: vscode.MessageItem = { title: vscode.l10n.t('Remove') };
    const names = targets.map((uri) => path.basename(uri.fsPath));
    const message =
      names.length === 1 && names[0] !== undefined
        ? vscode.l10n.t(
          'Remove "{0}" from the list? Files on disk will not be affected.',
          names[0]
        )
        : vscode.l10n.t(
          'Remove {0} folders ({1}) from the list? Files on disk will not be affected.',
          names.length,
          names.join(', ')
        );
    const confirmed = await vscode.window.showWarningMessage(message, { modal: true }, REMOVE);
    if (confirmed !== REMOVE) {
      return;
    }

    await folderStore.remove(targets);
  }
);

async function checkFolderExistAndRemoveNotFound(uri: vscode.Uri, folderStore: FolderStore): Promise<boolean> {
  const pathName = path.basename(uri.fsPath);
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
      throw error;
    }

    const REMOVE: vscode.MessageItem = { title: vscode.l10n.t('Remove') };
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t('"{0}" no longer exists on disk. Remove it from the list?', pathName),
      { modal: true },
      REMOVE
    );
    if (confirmed === REMOVE) {
      await folderStore.remove([uri]);
      return true;
    }
    return false;
  }
}

/** 打开前检查磁盘状态（失效时引导移除），随后 QuickPick 选择打开方式（当前窗口 / 新窗口 / 追加到当前工作区）。 */
async function openFolderWorkspace(uri: vscode.Uri, folderStore: FolderStore): Promise<void> {
  if (!await checkFolderExistAndRemoveNotFound(uri, folderStore)) {
    return;
  }

  // 当前窗口打开
  const CURRENT: vscode.QuickPickItem = {
    label: vscode.l10n.t('Open in This Window'),
    description: vscode.workspace.name,
    iconPath: new vscode.ThemeIcon('window'),
  };

  // 新窗口打开
  const NEW_WINDOW: vscode.QuickPickItem = {
    label: vscode.l10n.t('Open in New Window'),
    iconPath: new vscode.ThemeIcon('empty-window'),
  };

  const items: vscode.QuickPickItem[] = [CURRENT, NEW_WINDOW];

  // 添加到当前工作区
  // 暂不开放该功能
  if (vscode.workspace.workspaceFolders?.length && false) {
    items.push({
      label: vscode.l10n.t('Add to Workspace'),
      iconPath: new vscode.ThemeIcon('add'),
    });
  }

  const pathName = path.basename(uri.fsPath);

  const choice = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Open "{0}"', pathName),
    placeHolder: vscode.l10n.t('Choose how to open this folder'),
  });

  if (!choice) {
    return;
  }

  if ([CURRENT, NEW_WINDOW].includes(choice)) {
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: choice === NEW_WINDOW });
  } else {
    // 追加为当前工作区的工作区文件夹（多根工作区）
    const start = vscode.workspace.workspaceFolders?.length ?? 0;
    const updated = vscode.workspace.updateWorkspaceFolders(start, 0, { uri });
    if (!updated) {
      await vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to add "{0}" to the workspace.', pathName)
      );
    }
  }
}

/**
 * 打开登记的根文件夹：由条目右侧的 inline 图标触发（view/item/context 的 inline group）。
 * 目标取 inline 回传的元素。
 */
export const OPEN_FOLDER_COMMAND = defineCommand(
  'folderShelf.openFolder',
  async (item?: Entry): Promise<void> => {
    const folderStore = inject(FolderStore);

    const [target] = collectManagedUris(item, undefined);
    if (!target) {
      return;
    }
    await openFolderWorkspace(target, folderStore);
  }
);