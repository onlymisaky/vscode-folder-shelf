import * as vscode from 'vscode';
import * as path from 'node:path';
import { defineCommand } from './defineCommand';
import { defineWiredCommand } from './defineWiredCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';
import type { Entry, NodeEntry } from '../treeViews/foldersProvider';

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

  const { skipped } = await folderStore.add(uris);
  if (skipped > 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('{0} folder(s) already in the list and were skipped.', skipped)
    );
  }
})

export interface AddFolderCommandDeps {
  readonly foldersView: vscode.TreeView<Entry>;
}

/**
 * 移除文件夹：从树条目右键菜单触发，仅从列表移除（不影响磁盘文件）。
 * wire 版本：folders 视图实例由组合根显式传入，读取 selection（右键未选中项时
 * VSCode 会先选中它）天然支持多选，避免依赖右键菜单回传 TreeItem。
 */
export const REMOVE_FOLDER_COMMAND_WIRED = defineWiredCommand(
  'folderShelf.removeFolder',
  (deps: AddFolderCommandDeps) => {
    const { foldersView } = deps;
    return async function (): Promise<void> {
      const folderStore = inject(FolderStore);

      const targets = foldersView.selection
        .filter((entry): entry is NodeEntry => entry.kind === 'node' && entry.managed === true)
        .map((entry) => entry.uri);
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
    };
  }
);

/**
 * 移除文件夹：从树条目右键菜单触发，仅从列表移除（不影响磁盘文件）。
 * 支持多选：多选时 VSCode 以 (item, selection) 两个参数传入。
 */
export const REMOVE_FOLDER_COMMAND = defineCommand(
  'folderShelf.removeFolder',
  async (
    item?: vscode.TreeItem | vscode.TreeItem[],
    selection?: readonly vscode.TreeItem[]
  ): Promise<void> => {
    const folderStore = inject(FolderStore);

    const items: readonly vscode.TreeItem[] =
      selection && selection.length > 0
        ? selection
        : Array.isArray(item)
          ? item
          : item
            ? [item]
            : [];

    // 仅处理登记的根文件夹，避免误删多选中的子级条目
    const uris = new Map<string, vscode.Uri>();
    for (const treeItem of items) {
      if (treeItem.contextValue === 'folders.folder' && treeItem.resourceUri) {
        uris.set(treeItem.resourceUri.fsPath, treeItem.resourceUri);
      }
    }
    const targets = [...uris.values()];
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