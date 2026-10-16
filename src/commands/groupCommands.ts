import * as vscode from 'vscode';
import * as path from 'node:path';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { ViewModeStore } from '../services/viewModeStore';
import { inject } from '../services/container';
import { collectManagedUris } from './folderCommands';
import { GROUP_ICON, isGroupEntry } from '../treeViews/foldersProvider/entries';
import type { Entry } from '../treeViews/foldersProvider/entries';
import { confirmDanger, createRequiredValidator, editViaInputBox, showPicker } from '../utils';

/** 将树切换到标签模式。 */
export const SHOW_TAGGED_COMMAND = defineCommand('folderShelf.showTagged', () => {
  inject(ViewModeStore).set('tagged');
});

/** 将树切换到分组模式。 */
export const SHOW_GROUPED_COMMAND = defineCommand('folderShelf.showGrouped', () => {
  inject(ViewModeStore).set('grouped');
});

/** 将树切换到平铺模式。 */
export const SHOW_FLAT_COMMAND = defineCommand('folderShelf.showFlat', () => {
  inject(ViewModeStore).set('flat');
});

/**
 * 重命名菜单对应的分组，并更新该分组的全部条目。
 *
 * @param item - 触发菜单的条目；不是分组节点时忽略
 * @returns 表示用户已取消或重命名已完成的 Promise
 */
export const RENAME_GROUP_COMMAND = defineCommand(
  'folderShelf.renameGroup',
  async (item?: Entry): Promise<void> => {
    if (!isGroupEntry(item)) {
      return;
    }
    await editViaInputBox(
      item.name,
      {
        title: vscode.l10n.t('Rename Group'),
        emptyMessage: vscode.l10n.t('Group name cannot be empty.'),
      },
      (newName) => inject(FolderStore).renameGroup(item.name, newName)
    );
  }
);

/**
 * 经用户确认后解散菜单对应的分组，保留其中的条目。
 *
 * @param item - 触发菜单的条目；不是分组节点时忽略
 * @returns 表示用户已取消或分组已解散的 Promise
 */
export const DISSOLVE_GROUP_COMMAND = defineCommand(
  'folderShelf.dissolveGroup',
  async (item?: Entry): Promise<void> => {
    if (!isGroupEntry(item)) {
      return;
    }
    const confirmed = await confirmDanger(
      vscode.l10n.t('Dissolve group "{0}"? Items inside will become ungrouped.', item.name),
      vscode.l10n.t('Dissolve')
    );
    if (!confirmed) {
      return;
    }
    await inject(FolderStore).dissolveGroup(item.name);
  }
);

/**
 * 将所选条目移出各自分组；本来未分组的条目保持不变。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的完整选择
 * @returns 表示分组更新完成的 Promise
 */
export const MOVE_OUT_OF_GROUP_COMMAND = defineCommand(
  'folderShelf.moveOutOfGroup',
  async (item?: Entry, selectedItems?: readonly Entry[]): Promise<void> => {
    const targets = collectManagedUris(item, selectedItems);
    if (targets.length === 0) {
      return;
    }
    await inject(FolderStore).setItemGroups(targets, undefined);
  }
);

/**
 * 通过选择器将所选条目移入现有或新分组。选择中含已分组条目时，也可将其移出分组。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的完整选择
 * @returns 表示用户已取消或分组已更新的 Promise
 */
export const MOVE_TO_GROUP_COMMAND = defineCommand(
  'folderShelf.moveToGroup',
  async (item?: Entry, selectedItems?: readonly Entry[]): Promise<void> => {
    const folderStore = inject(FolderStore);
    const viewModeStore = inject(ViewModeStore);

    const targets = collectManagedUris(item, selectedItems);
    if (targets.length === 0) {
      return;
    }

    const groups = await folderStore.getGroups();
    const items: vscode.QuickPickItem[] = groups.map((name) => ({
      label: name,
      iconPath: new vscode.ThemeIcon(GROUP_ICON),
    }));

    /** 打开独立输入框创建分组的选择项。 */
    const NEW_GROUP_ITEM: vscode.QuickPickItem = {
      label: vscode.l10n.t('New Group…'),
      iconPath: new vscode.ThemeIcon('plus'),
    };
    items.push(NEW_GROUP_ITEM);

    // 选择中至少有一个已分组条目时才显示“移出分组”。
    const withGroups = await folderStore.getAllWithMeta();
    const groupByPath = new Map(withGroups.map((entry) => [entry.uri.toString(), entry.group]));
    const hasGrouped = targets.some((uri) => groupByPath.get(uri.toString()) !== undefined);
    /** 将所选条目移出分组的选择项。 */
    const MOVE_OUT_OF_GROUP_ITEM: vscode.QuickPickItem = {
      label: vscode.l10n.t('Remove from Group'),
      iconPath: new vscode.ThemeIcon('close'),
    };
    if (hasGrouped) {
      items.push(MOVE_OUT_OF_GROUP_ITEM);
    }

    // 在标题中列出操作对象，避免多选时目标不明确。
    const names = targets.map((uri) => path.basename(uri.fsPath));
    const title = vscode.l10n.t('Move {0} to Group', names.join(', '));

    const choice = await showPicker(items, {
      title,
      placeholder: vscode.l10n.t('Enter group name'),
      canAddItem: true,
      createHint: vscode.l10n.t('Create group'),
    });
    if (choice === undefined) {
      return;
    }

    // 直接输入新名称时创建分组并移动条目。
    if (choice.kind === 'created') {
      await folderStore.setItemGroups(targets, choice.name);
      return;
    }

    // “移出分组”选择项清除所选条目的分组。
    if (choice.item === MOVE_OUT_OF_GROUP_ITEM) {
      await folderStore.setItemGroups(targets, undefined);
      return;
    }

    if (choice.item === NEW_GROUP_ITEM) {
      const name = await vscode.window.showInputBox({
        title: vscode.l10n.t('New Group'),
        prompt: vscode.l10n.t('Enter group name'),
        validateInput: createRequiredValidator(vscode.l10n.t('Group name cannot be empty.')),
      });
      if (name === undefined || name.trim() === '') {
        return;
      }
      await folderStore.setItemGroups(targets, name.trim());
    } else {
      await folderStore.setItemGroups(targets, choice.item.label);
    }

    // 自动切换视图的功能开关目前关闭，操作后保留用户当前模式。
    if (viewModeStore.mode === 'flat' && false) {
      viewModeStore.set('grouped');
    }
  }
);
