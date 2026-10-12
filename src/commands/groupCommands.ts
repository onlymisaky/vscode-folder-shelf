import * as vscode from 'vscode';
import * as path from 'node:path';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { ViewModeStore } from '../services/viewModeStore';
import { inject } from '../services/container';
import { collectManagedUris } from './folderCommands';
import { GROUP_ICON, isGroupEntry } from '../treeViews/foldersProvider/entries';
import type { Entry } from '../treeViews/foldersProvider/entries';
import { confirmDanger, createNameValidator, renameViaInputBox } from '../utils';

/** pickGroup 的结果：选中某个选项 / 输入了不存在的分组名直接创建 / 取消 */
type GroupPickResult =
  | { kind: 'choice'; item: vscode.QuickPickItem }
  | { kind: 'create'; name: string }
  | undefined;

/**
 * 分组选择 QuickPick：输入不存在的分组名时在最上方动态提供「创建分组 "{0}"」项，回车直接创建并归组，
 * 无需再走「新建分组…」的二次输入框。
 */
function pickGroup(
  items: readonly vscode.QuickPickItem[],
  existingGroups: readonly string[],
  title: string
): Promise<GroupPickResult> {
  const quickPick = vscode.window.createQuickPick();
  quickPick.title = title;
  quickPick.placeholder = vscode.l10n.t('Enter group name');

  // 输入值 trim 后非空且不是现有分组名 → 动态插入创建项（label 含输入值才能在内置过滤中存活）
  let pendingCreate: { name: string; item: vscode.QuickPickItem } | undefined;
  // 重挂 items：创建项（若有）→ 静态选项；首挂走同一路径，show 前必须先挂 items
  const remount = (): void => {
    quickPick.items = pendingCreate ? [pendingCreate.item, ...items] : [...items];
  };
  quickPick.onDidChangeValue((value) => {
    const trimmed = value.trim();
    pendingCreate =
      trimmed === '' || existingGroups.includes(trimmed)
        ? undefined
        : { name: trimmed, item: { label: `$(plus) ${vscode.l10n.t('Create group "{0}"', trimmed)}` } };
    remount();
  });
  remount();

  return new Promise<GroupPickResult>((resolve) => {
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (pendingCreate !== undefined && selected === pendingCreate.item) {
        resolve({ kind: 'create', name: pendingCreate.name });
      } else if (selected !== undefined) {
        resolve({ kind: 'choice', item: selected });
      }
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(undefined);
    });
    quickPick.show();
  });
}

/** 以标签形式展示（视图标题栏按钮，三态循环切换中的一环：平铺 → 标签 → 分组） */
export const SHOW_TAGGED_COMMAND = defineCommand('folderShelf.showTagged', () => {
  inject(ViewModeStore).set('tagged');
});

/** 以分组形式展示（视图标题栏按钮，与 showFlat/showTagged 随上下文键互斥显示） */
export const SHOW_GROUPED_COMMAND = defineCommand('folderShelf.showGrouped', () => {
  inject(ViewModeStore).set('grouped');
});

/** 平铺展示（视图标题栏按钮，与 showGrouped/showTagged 随上下文键互斥显示） */
export const SHOW_FLAT_COMMAND = defineCommand('folderShelf.showFlat', () => {
  inject(ViewModeStore).set('flat');
});

/** 重命名分组：批量改写所属条目的 group 字段。目标取右键回传的分组节点。 */
export const RENAME_GROUP_COMMAND = defineCommand(
  'folderShelf.renameGroup',
  async (item?: Entry): Promise<void> => {
    if (!isGroupEntry(item)) {
      return;
    }
    await renameViaInputBox(
      item.name,
      {
        title: vscode.l10n.t('Rename Group'),
        emptyMessage: vscode.l10n.t('Group name cannot be empty.'),
      },
      (newName) => inject(FolderStore).renameGroup(item.name, newName)
    );
  }
);

/** 解散分组：确认后所属条目回到未分组（条目本身保留）。目标取右键回传的分组节点。 */
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

/** 移出分组：把所选条目移出所在分组、回到未分组（未分组条目自动跳过，无副作用）。区别于 dissolveGroup（解散整个分组）。目标从菜单回传参数解析，支持多选。 */
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
 * 移动条目到分组（多选混选文件夹/文件均支持，目标同 removeItem 从菜单回传参数解析）。
 * QuickPick 列出现有分组 + 「新建分组…」+「移出分组」（仅当选中项中存在已分组条目时显示）；
 * 输入不存在的分组名时直接回车即可创建归组（pickGroup 动态创建项）。
 * 归组/建组后若当前为平铺模式则自动切到分组展示（所见即所得）。
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

    const NEW_GROUP_ITEM: vscode.QuickPickItem = {
      label: vscode.l10n.t('New Group…'),
      iconPath: new vscode.ThemeIcon('plus'),
    };
    items.push(NEW_GROUP_ITEM);

    // 仅当选中项中存在已分组条目时才提供「移出分组」
    const withGroups = await folderStore.getAllWithMeta();
    const groupByPath = new Map(withGroups.map((entry) => [entry.uri.fsPath, entry.group]));
    const hasGrouped = targets.some((uri) => groupByPath.get(uri.fsPath) !== undefined);
    const MOVE_OUT_OF_GROUP_ITEM: vscode.QuickPickItem = {
      label: vscode.l10n.t('Remove from Group'),
      iconPath: new vscode.ThemeIcon('close'),
    };
    if (hasGrouped) {
      items.push(MOVE_OUT_OF_GROUP_ITEM);
    }

    // 标题显示待移动条目名单，让操作对象一目了然
    const names = targets.map((uri) => path.basename(uri.fsPath));
    const title = vscode.l10n.t('Move {0} to Group', names.join(', '));

    const choice = await pickGroup(items, groups, title);
    if (choice === undefined) {
      return;
    }

    if (choice.kind === 'create') {
      await folderStore.setItemGroups(targets, choice.name);
      return;
    }

    if (choice.item === MOVE_OUT_OF_GROUP_ITEM) {
      await folderStore.setItemGroups(targets, undefined);
      return;
    }

    if (choice.item === NEW_GROUP_ITEM) {
      const name = await vscode.window.showInputBox({
        title: vscode.l10n.t('New Group'),
        prompt: vscode.l10n.t('Enter group name'),
        validateInput: createNameValidator('Group name cannot be empty.'),
      });
      if (name === undefined || name.trim() === '') {
        return;
      }
      await folderStore.setItemGroups(targets, name.trim());
    } else {
      await folderStore.setItemGroups(targets, choice.item.label);
    }

    // 归组/建组后若为平铺模式自动切到分组展示，让结果立即可见
    // 暂时不需要自动切换
    if (viewModeStore.mode === 'flat' && false) {
      viewModeStore.set('grouped');
    }
  }
);
