import * as vscode from 'vscode';
import * as path from 'node:path';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';
import { isManagedEntry } from '../treeViews/foldersProvider/entries';
import type { Entry } from '../treeViews/foldersProvider/entries';

/** 加入列表并提示被跳过的重复项（addItem 与「添加当前项目」共用）。 */
async function addAndReportSkipped(
  folderStore: FolderStore,
  uris: readonly vscode.Uri[]
): Promise<void> {
  const { skipped } = await folderStore.add(uris);
  if (skipped > 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('{0} item(s) already in the list and were skipped.', skipped)
    );
  }
}

export const ADD_ITEM_COMMAND = defineCommand('folderShelf.addItem', async () => {
  const folderStore = inject(FolderStore);

  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: true,
    openLabel: vscode.l10n.t('Add'),
    title: vscode.l10n.t('Select Items to Add'),
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
 * 重新加载 config.json：文件可能在外部被修改，丢弃缓存并触发视图刷新。
 */
export const REFRESH_COMMAND = defineCommand('folderShelf.refresh', () => {
  inject(FolderStore).refresh();
});

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
 * 从菜单/inline 图标回传的参数解析目标（登记的根文件夹），按 fsPath 去重。
 * 实测：回传的是 getChildren 返回的元素本身（Entry），而非 TreeItem；
 * 多选时第二参数为 selection 数组。两个命令均仅从菜单触发，参数恒有值。
 */
export function collectManagedUris(item?: Entry, selectedItems?: readonly Entry[]): vscode.Uri[] {
  const uris = new Map<string, vscode.Uri>();
  for (const raw of [item, ...(selectedItems ?? [])]) {
    if (isManagedEntry(raw)) {
      uris.set(raw.uri.fsPath, raw.uri);
    }
  }
  return [...uris.values()];
}

/**
 * 移除登记的文件夹/文件：从树条目右键菜单触发，仅从列表移除（不影响磁盘文件）。
 * 目标从菜单回传参数解析（多选时 VSCode 回传 (item, selectedItems)）。
 */
export const REMOVE_ITEM_COMMAND = defineCommand(
  'folderShelf.removeItem',
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
          'Remove {0} item(s) ({1}) from the list? Files on disk will not be affected.',
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

/**
 * 系统文件管理器「定位 / 打开」两项标签，按平台区分命名：
 * macOS 为 Finder，Windows 为文件资源管理器，Linux 无统一名称泛称文件管理器。
 * 各分支均为静态字面量，保证 l10n 提取完整。
 */
function fileManagerLabels(): { reveal: string; open: string } {
  if (process.platform === 'darwin') {
    return { reveal: vscode.l10n.t('Reveal in Finder'), open: vscode.l10n.t('Open in Finder') };
  }
  if (process.platform === 'win32') {
    return {
      reveal: vscode.l10n.t('Reveal in File Explorer'),
      open: vscode.l10n.t('Open in File Explorer'),
    };
  }
  return {
    reveal: vscode.l10n.t('Reveal in File Manager'),
    open: vscode.l10n.t('Open in File Manager'),
  };
}

/** 打开前检查磁盘状态（失效时引导移除），随后 QuickPick 选择打开方式（当前窗口 / 新窗口 / 终端 / 调试终端 / 文件管理器 / 工作区）。 */
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

  // 在 VSCode 集成终端中打开
  const TERMINAL: vscode.QuickPickItem = {
    label: vscode.l10n.t('Open in Terminal'),
    iconPath: new vscode.ThemeIcon('terminal'),
  };

  // 在调试终端（JavaScript Debug Terminal）中打开
  const DEBUG_TERMINAL: vscode.QuickPickItem = {
    label: vscode.l10n.t('Open in Debug Terminal'),
    iconPath: new vscode.ThemeIcon('debug'),
  };

  // 在系统文件管理器中定位：打开父级目录并选中该文件夹
  const { reveal: REVEAL_LABEL, open: OPEN_LABEL } = fileManagerLabels();
  const REVEAL_IN_FILE_MANAGER: vscode.QuickPickItem = {
    label: REVEAL_LABEL,
    iconPath: new vscode.ThemeIcon('folder-opened'),
  };

  // 在系统文件管理器中直接打开该文件夹
  const OPEN_IN_FILE_MANAGER: vscode.QuickPickItem = {
    label: OPEN_LABEL,
    iconPath: new vscode.ThemeIcon('link-external'),
  };

  const items: vscode.QuickPickItem[] = [
    CURRENT,
    NEW_WINDOW,
    TERMINAL,
    DEBUG_TERMINAL,
    REVEAL_IN_FILE_MANAGER,
    OPEN_IN_FILE_MANAGER,
  ];

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
    return;
  }

  if (choice === TERMINAL) {
    const terminal = vscode.window.createTerminal({
      name: path.basename(uri.fsPath),
      cwd: uri.fsPath,
    });
    terminal.show();
    return;
  }

  if (choice === DEBUG_TERMINAL) {
    // js-debug 内置命令，参数形态与其内部目录选择流程一致：第三参传 { cwd }
    await vscode.commands.executeCommand(
      'extension.js-debug.createDebuggerTerminal',
      undefined,
      undefined,
      { cwd: uri.fsPath }
    );
    return;
  }

  if (choice === REVEAL_IN_FILE_MANAGER) {
    await vscode.commands.executeCommand('revealFileInOS', uri);
    return;
  }

  if (choice === OPEN_IN_FILE_MANAGER) {
    await vscode.env.openExternal(uri);
    return;
  }

  // 追加为当前工作区的工作区文件夹（多根工作区）
  const start = vscode.workspace.workspaceFolders?.length ?? 0;
  const updated = vscode.workspace.updateWorkspaceFolders(start, 0, { uri });
  if (!updated) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to add "{0}" to the workspace.', pathName)
    );
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