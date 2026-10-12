import * as vscode from 'vscode';
import * as path from 'node:path';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';
import { isManagedEntry } from '../treeViews/foldersProvider/entries';
import type { Entry } from '../treeViews/foldersProvider/entries';

/** 当前平台文件管理器相关操作的本地化标签。 */
interface FileManagerLabels {
  /** 在父目录中定位并选中目标资源的操作标签 */
  readonly reveal: string;
  /** 直接在系统文件管理器中打开目标目录的操作标签 */
  readonly open: string;
}

/**
 * 加入列表并提示被跳过的重复项（addItem 与「添加当前项目」共用）。
 *
 * @param folderStore - 收藏列表存储服务（经容器注入）
 * @param uris - 待添加的资源 Uri 列表
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
 * 从菜单或 inline 图标回传的参数中提取登记条目，并按 fsPath 去重。
 * VSCode 回传 getChildren 产生的 Entry；多选时第二个参数为当前 selection。
 *
 * @param item - 触发菜单的树条目（单选时的目标）
 * @param selectedItems - 多选时 VSCode 额外回传的当前 selection 数组
 * @returns 目标条目的 Uri 列表（按 fsPath 去重、保持出现顺序）；无有效目标时为空数组
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
 * 目标从菜单回传参数解析（多选时 VSCode 回传 (item, selectedItems)），确认后批量移除。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的 selection 数组
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
 * 检查文件夹在磁盘上是否存在；不存在时弹窗引导用户从列表移除（其他错误原样抛出）。
 *
 * @param uri - 待检查的资源 Uri
 * @param folderStore - 收藏列表存储服务（用户确认移除时调用）
 * @returns 资源存在，或用户确认移除了失效条目时为 true；资源失效且用户取消移除时为 false
 */
async function checkFolderExistAndRemoveNotFound(uri: vscode.Uri, folderStore: FolderStore): Promise<boolean> {
  const pathName = path.basename(uri.fsPath);
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    // 仅文件不存在才引导移除，其余错误（权限等）原样抛出
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
 *
 * @returns reveal 为「定位到该文件夹」标签，open 为「直接打开该文件夹」标签（均已经 l10n 翻译）
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
 * 打开前检查磁盘状态（失效时引导移除），随后 QuickPick 选择打开方式
 * （当前窗口 / 新窗口 / 终端 / 调试终端 / 文件管理器）。
 *
 * @param uri - 待打开的文件夹 Uri
 * @param folderStore - 收藏列表存储服务（失效条目移除时使用）
 */
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

  // 预留功能：将目录添加到当前多根工作区。当前不向用户展示，保留实现供后续开放
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

  // 仅对应上方当前禁用的「添加到工作区」选项
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
 *
 * @param item - inline 按钮所在行的树条目
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
