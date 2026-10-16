import * as vscode from 'vscode';
import * as path from 'node:path';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';
import { isManagedEntry } from '../treeViews/foldersProvider/entries';
import type { Entry } from '../treeViews/foldersProvider/entries';
import { showPicker, isSupportedScheme, getUriCwd, isFsAccessible } from '../utils';

/** 当前平台文件管理器操作的本地化标签。 */
interface FileManagerLabels {
  /** 在父目录中定位并选中目标资源的操作标签。 */
  readonly reveal: string;
  /** 直接在系统文件管理器中打开目标目录的操作标签。 */
  readonly open: string;
}

/**
 * 将资源加入列表，并提示因重复而跳过的数量。
 *
 * @param folderStore - 列表存储服务
 * @param uris - 待添加的资源 URI
 * @returns 表示添加和提示均已完成的 Promise
 */
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

/**
 * 打开文件选择对话框添加文件夹/文件（视图标题栏「添加」按钮触发）。
 * 支持文件与文件夹混合多选；重复项自动跳过并提示数量。
 *
 * @returns 表示用户已完成或取消选择的 Promise
 */
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
 * 将当前窗口的所有受支持工作区根目录加入列表。本地、远程和虚拟文件系统
 * 工作区均受支持，其他 URI 协议会被忽略。
 *
 * @returns 表示添加和提示均已完成的 Promise
 */
export const ADD_CURRENT_PROJECT_COMMAND = defineCommand(
  'folderShelf.addCurrentProject',
  async (): Promise<void> => {
    const folderStore = inject(FolderStore);

    const uris = (vscode.workspace.workspaceFolders ?? [])
      .map((folder) => folder.uri)
      .filter((uri) => isSupportedScheme(uri.scheme));

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
 * 丢弃配置缓存并刷新树。
 */
export const REFRESH_COMMAND = defineCommand('folderShelf.refresh', () => {
  inject(FolderStore).refresh();
});

/**
 * 通过 VS Code 的树视图命令折叠树中的所有目录。
 *
 * @returns 表示折叠命令已执行的 Promise
 */
export const COLLAPSE_ALL_COMMAND = defineCommand('folderShelf.collapseAll', async () => {
  await vscode.commands.executeCommand(
    'workbench.actions.treeView.folderShelf.views.folders.collapseAll'
  );
});

/**
 * 从菜单参数中提取受管理节点，并按规范化 URI 去重。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的完整选择
 * @returns 去重且保持出现顺序的资源 URI
 */
export function collectManagedUris(item?: Entry, selectedItems?: readonly Entry[]): vscode.Uri[] {
  const uris = new Map<string, vscode.Uri>();
  for (const raw of [item, ...(selectedItems ?? [])]) {
    if (isManagedEntry(raw)) {
      uris.set(raw.uri.toString(), raw.uri);
    }
  }
  return [...uris.values()];
}

/**
 * 经用户确认后从列表移除所选条目，不删除磁盘资源。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的完整选择
 * @returns 表示用户已取消或条目已移除的 Promise
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

/**
 * 检查目录是否存在。确认不存在时询问是否从列表移除；当前窗口无法访问的
 * 远程或虚拟资源继续进入打开流程，由 VS Code 建立连接或激活文件系统提供程序。
 *
 * @param uri - 待检查的目录 URI
 * @param folderStore - 用户确认后用于移除条目的存储服务
 * @returns 资源存在或当前无法验证时为 `true`；确认不存在时为 `false`
 */
async function checkFolderExistAndRemoveNotFound(uri: vscode.Uri, folderStore: FolderStore): Promise<boolean> {
  // 其他远程连接的资源交给 `vscode.openFolder` 建立连接，不在当前连接中探测。
  if (!isFsAccessible(uri)) {
    return true;
  }
  const pathName = path.basename(uri.fsPath);
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    // 文件系统提供程序不可用不代表资源不存在，继续尝试打开。
    if (error instanceof vscode.FileSystemError && error.code === 'Unavailable') {
      return true;
    }
    // 只有确认不存在时才建议移除；权限等错误继续抛出。
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
    }
    return false;
  }
}

/**
 * 返回符合当前操作系统用语的“定位”和“打开”标签。各分支使用静态字符串，
 * 使本地化提取器能够识别所有文案。
 *
 * @returns 文件管理器操作标签
 */
function fileManagerLabels(): FileManagerLabels {
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

/**
 * 检查目录状态，并让用户选择在窗口、终端或系统文件管理器中打开。
 *
 * @param uri - 待打开目录的 URI
 * @param folderStore - 确认目录缺失时用于移除条目的存储服务
 * @returns 表示用户已取消或打开操作已完成的 Promise
 */
async function openFolderWorkspace(uri: vscode.Uri, folderStore: FolderStore): Promise<void> {
  if (!await checkFolderExistAndRemoveNotFound(uri, folderStore)) {
    return;
  }

  // 窗口打开方式对所有支持的 URI 协议可用。
  const CURRENT: vscode.QuickPickItem = {
    label: vscode.l10n.t('Open in This Window'),
    description: vscode.workspace.name,
    iconPath: new vscode.ThemeIcon('window'),
  };

  const NEW_WINDOW: vscode.QuickPickItem = {
    label: vscode.l10n.t('Open in New Window'),
    iconPath: new vscode.ThemeIcon('empty-window'),
  };

  // 终端和系统文件管理器选项会在下方按 URI 协议筛选。
  const TERMINAL: vscode.QuickPickItem = {
    label: vscode.l10n.t('Open in Terminal'),
    iconPath: new vscode.ThemeIcon('terminal'),
  };

  const DEBUG_TERMINAL: vscode.QuickPickItem = {
    label: vscode.l10n.t('Open in Debug Terminal'),
    iconPath: new vscode.ThemeIcon('debug'),
  };

  const { reveal: REVEAL_LABEL, open: OPEN_LABEL } = fileManagerLabels();
  const REVEAL_IN_FILE_MANAGER: vscode.QuickPickItem = {
    label: REVEAL_LABEL,
    iconPath: new vscode.ThemeIcon('folder-opened'),
  };

  const OPEN_IN_FILE_MANAGER: vscode.QuickPickItem = {
    label: OPEN_LABEL,
    iconPath: new vscode.ThemeIcon('link-external'),
  };

  // 本地资源支持所有打开方式；远程资源只有连接到当前窗口时才能创建终端。
  const items: vscode.QuickPickItem[] = [CURRENT, NEW_WINDOW];
  if (uri.scheme === 'file') {
    items.push(TERMINAL, DEBUG_TERMINAL, REVEAL_IN_FILE_MANAGER, OPEN_IN_FILE_MANAGER);
  } else if (uri.scheme === 'vscode-remote' && isFsAccessible(uri)) {
    items.push(TERMINAL, DEBUG_TERMINAL);
  }

  // 工作区添加选项尚未开放；保留分支便于后续启用。
  if (vscode.workspace.workspaceFolders?.length && false) {
    items.push({
      label: vscode.l10n.t('Add to Workspace'),
      iconPath: new vscode.ThemeIcon('add'),
    });
  }

  const pathName = path.basename(uri.fsPath);

  const choice = await showPicker(items, {
    title: vscode.l10n.t('Open "{0}"', pathName),
    placeholder: vscode.l10n.t('Choose how to open this folder'),
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
      cwd: getUriCwd(uri),
    });
    terminal.show();
    return;
  }

  if (choice === DEBUG_TERMINAL) {
    // js-debug 通过 DAP 传递启动参数，因此 `cwd` 必须使用可序列化的路径字符串。
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

  // 该分支只会在上方启用“添加到工作区”选项后执行。
  const start = vscode.workspace.workspaceFolders?.length ?? 0;
  const updated = vscode.workspace.updateWorkspaceFolders(start, 0, { uri });
  if (!updated) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('Failed to add "{0}" to the workspace.', pathName)
    );
  }
}

/**
 * 打开登记的根目录。命令由条目右侧的行内按钮触发。
 *
 * @param item - 行内按钮所在的树条目
 * @returns 表示用户已取消或打开操作已完成的 Promise
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

/**
 * 为不可访问条目的提示图标提供空命令。VS Code 只有在行内图标绑定命令时才会显示它；
 * 具体原因由树项的悬停提示说明。
 */
export const UNAVAILABLE_HINT_COMMAND = defineCommand('folderShelf.unavailableHint', () => {});
