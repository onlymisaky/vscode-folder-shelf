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

/**
 * pickGroup 的结果：选中某个选项（choice）/ 输入了不存在的分组名直接创建（create）/ 取消（undefined）。
 */
type GroupPickResult =
  | {
      /** 命中了列表中的现有选项 */
      kind: 'choice';
      /** 被选中的 QuickPick 行对象（可能是动作项，由调用方按对象同一性识别） */
      item: vscode.QuickPickItem;
    }
  | {
      /** 输入了不存在的分组名并确认创建 */
      kind: 'create';
      /** trim 后的新分组名 */
      name: string;
    }
  | undefined;

/** 分组选择器中根据输入动态生成的创建项。 */
interface PendingGroupCreation {
  /** 已去除首尾空白、等待创建的分组名 */
  readonly name: string;
  /** 显示在选择器首行的创建动作 */
  readonly item: vscode.QuickPickItem;
}

/**
 * 分组选择 QuickPick：输入不存在的分组名时在最上方动态提供「创建分组 "{0}"」项，回车直接创建并归组，
 * 无需再走「新建分组…」的二次输入框。
 *
 * @param items - 静态选项列表（现有分组 + 附加动作项，由调用方构造）
 * @param existingGroups - 现有分组名列表（判断输入值是否命中「创建」项）
 * @param title - 对话框标题（须为已翻译文案）
 * @returns 用户确认的结果：choice 为选中项，create 为新建分组名；取消（Esc）时为 undefined
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
  let pendingCreate: PendingGroupCreation | undefined;

  /**
   * 按「动态创建项在前、静态选项在后」的顺序重新挂载选择器条目。
   */
  const remount = (): void => {
    quickPick.items = pendingCreate ? [pendingCreate.item, ...items] : [...items];
  };

  // 输入值变化时，根据 trim 后非空且不是现有分组名判断是否需要动态插入创建项
  // 并重挂 items
  quickPick.onDidChangeValue((value) => {
    const trimmed = value.trim();
    if (trimmed === '' || existingGroups.includes(trimmed)) {
      // 空输入或命中现有分组名 → 无创建项
      pendingCreate = undefined;
    } else {
      // 输入新名 → 动态插入创建项（label 含输入值才能在内置过滤中存活）
      pendingCreate = {
        name: trimmed,
        item: { label: `$(plus) ${vscode.l10n.t('Create group "{0}"', trimmed)}` },
      };
    }
    remount();
  });
  remount();

  return new Promise<GroupPickResult>((resolve) => {
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      // 命中动态创建项 → 返回 create；命中静态选项 → 返回 choice；无选中则仅关闭
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

/**
 * 重命名分组：批量改写所属条目的 group 字段。目标取右键回传的分组节点。
 *
 * @param item - 触发菜单的树条目（须为分组节点，否则忽略）
 */
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

/**
 * 解散分组：确认后所属条目回到未分组（条目本身保留）。目标取右键回传的分组节点。
 *
 * @param item - 触发菜单的树条目（须为分组节点，否则忽略）
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
 * 移出分组：把所选条目移出所在分组、回到未分组（未分组条目自动跳过，无副作用）。
 * 区别于 dissolveGroup（解散整个分组）。目标从菜单回传参数解析，支持多选。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的 selection 数组
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
 * 移动条目到分组（多选混选文件夹/文件均支持，目标同 removeItem 从菜单回传参数解析）。
 * QuickPick 列出现有分组 + 「新建分组…」+「移出分组」（仅当选中项中存在已分组条目时显示）；
 * 输入不存在的分组名时直接回车即可创建归组（pickGroup 动态创建项）。
 * 归组后自动切换到分组视图的预留逻辑当前未开放，但保留在命令末尾供后续启用。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的 selection 数组
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

    /** 附加动作项：走「新建分组…」二次输入框 */
    const NEW_GROUP_ITEM: vscode.QuickPickItem = {
      label: vscode.l10n.t('New Group…'),
      iconPath: new vscode.ThemeIcon('plus'),
    };
    items.push(NEW_GROUP_ITEM);

    // 仅当选中项中存在已分组条目时才提供「移出分组」
    const withGroups = await folderStore.getAllWithMeta();
    const groupByPath = new Map(withGroups.map((entry) => [entry.uri.fsPath, entry.group]));
    const hasGrouped = targets.some((uri) => groupByPath.get(uri.fsPath) !== undefined);
    /** 附加动作项：把选中条目移出所在分组 */
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

    // 输入新名直接创建并归组
    if (choice.kind === 'create') {
      await folderStore.setItemGroups(targets, choice.name);
      return;
    }

    // 命中「移出分组」动作项
    if (choice.item === MOVE_OUT_OF_GROUP_ITEM) {
      await folderStore.setItemGroups(targets, undefined);
      return;
    }

    if (choice.item === NEW_GROUP_ITEM) {
      const name = await vscode.window.showInputBox({
        title: vscode.l10n.t('New Group'),
        prompt: vscode.l10n.t('Enter group name'),
        validateInput: createNameValidator(vscode.l10n.t('Group name cannot be empty.')),
      });
      if (name === undefined || name.trim() === '') {
        return;
      }
      await folderStore.setItemGroups(targets, name.trim());
    } else {
      await folderStore.setItemGroups(targets, choice.item.label);
    }

    // 预留功能：归组后自动切换到分组视图；当前保持用户原有视图模式
    if (viewModeStore.mode === 'flat' && false) {
      viewModeStore.set('grouped');
    }
  }
);
