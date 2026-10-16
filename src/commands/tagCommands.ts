import * as vscode from 'vscode';
import * as path from 'node:path';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';
import { collectManagedUris } from './folderCommands';
import { TAG_ICON, isTagEntry } from '../treeViews/foldersProvider/entries';
import type { Entry } from '../treeViews/foldersProvider/entries';
import { confirmDanger, editViaInputBox, showPicker } from '../utils';

/**
 * 标签选择项。`tagName` 保存最终写入配置的标签名。
 */
type TagPickItem = vscode.QuickPickItem & {
  /** 选择项对应的标签名。 */
  readonly tagName: string;
};

/**
 * 打开标签多选器，并用确认后的完整标签集合替换所有目标条目的标签。初始勾选项是
 * 目标条目标签的并集；确认空集合会清除全部标签。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的完整选择
 * @param buildTitle - 根据逗号分隔的条目名称生成标题
 * @returns 表示用户已取消或标签已更新的 Promise
 */
async function pickAndSetTags(
  item: Entry | undefined,
  selectedItems: readonly Entry[] | undefined,
  buildTitle: (names: string) => string
): Promise<void> {
  const folderStore = inject(FolderStore);

  const targets = collectManagedUris(item, selectedItems);
  if (targets.length === 0) {
    return;
  }

  const [existingTags, allMeta] = await Promise.all([
    folderStore.getTags(),
    folderStore.getAllWithMeta(),
  ]);
  const tagsByPath = new Map(allMeta.map((meta) => [meta.uri.toString(), meta.tags]));
  // 预选所有目标已有标签，避免用户未改动就确认时意外清空标签。
  const currentTags = [...new Set(targets.flatMap((uri) => tagsByPath.get(uri.toString()) ?? []))];

  // 选择结果通过 `tagName` 还原为配置中的标签字符串。
  const items: TagPickItem[] = existingTags.map((name) => ({
    tagName: name,
    label: name,
    iconPath: new vscode.ThemeIcon(TAG_ICON),
  }));

  // 在标题中列出操作对象，避免多选时目标不明确。
  const names = targets.map((uri) => path.basename(uri.fsPath));
  const picked = await showPicker(items, {
    title: buildTitle(names.join(', ')),
    placeholder: vscode.l10n.t('Select or enter tag name'),
    canSelectMany: true,
    canAddItem: true,
    checkedNames: currentTags,
    createHint: vscode.l10n.t('Create tag'),
    buildCreatedItem: (name) => ({ tagName: name, label: name, iconPath: new vscode.ThemeIcon(TAG_ICON) }),
  });
  if (picked === undefined) {
    return;
  }

  await folderStore.setItemTags(targets, picked.map((tagItem) => tagItem.tagName));
}

/**
 * 打开“添加标签”选择器并替换所选条目的标签集合。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的完整选择
 * @returns 表示用户已取消或标签已更新的 Promise
 */
export const ADD_TAG_COMMAND = defineCommand(
  'folderShelf.addTag',
  async (item?: Entry, selectedItems?: readonly Entry[]): Promise<void> => {
    await pickAndSetTags(item, selectedItems, (names) => vscode.l10n.t('Add Tags to {0}', names));
  }
);

/**
 * 打开“管理标签”选择器并替换所选条目的标签集合。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的完整选择
 * @returns 表示用户已取消或标签已更新的 Promise
 */
export const MANAGE_TAGS_COMMAND = defineCommand(
  'folderShelf.manageTags',
  async (item?: Entry, selectedItems?: readonly Entry[]): Promise<void> => {
    await pickAndSetTags(item, selectedItems, (names) => vscode.l10n.t('Manage Tags for {0}', names));
  }
);

/**
 * 重命名菜单对应的标签，并更新所有使用该标签的条目。
 *
 * @param item - 触发菜单的条目；不是标签节点时忽略
 * @returns 表示用户已取消或重命名已完成的 Promise
 */
export const RENAME_TAG_COMMAND = defineCommand(
  'folderShelf.renameTag',
  async (item?: Entry): Promise<void> => {
    if (!isTagEntry(item)) {
      return;
    }
    await editViaInputBox(
      item.name,
      {
        title: vscode.l10n.t('Rename Tag'),
        emptyMessage: vscode.l10n.t('Tag name cannot be empty.'),
      },
      (newName) => inject(FolderStore).renameTag(item.name, newName)
    );
  }
);

/**
 * 经用户确认后删除菜单对应的标签，保留所有条目。
 *
 * @param item - 触发菜单的条目；不是标签节点时忽略
 * @returns 表示用户已取消或标签已删除的 Promise
 */
export const DELETE_TAG_COMMAND = defineCommand(
  'folderShelf.deleteTag',
  async (item?: Entry): Promise<void> => {
    if (!isTagEntry(item)) {
      return;
    }
    const confirmed = await confirmDanger(
      vscode.l10n.t('Delete tag "{0}"? The tag will be removed from all items that have it.', item.name),
      vscode.l10n.t('Delete')
    );
    if (!confirmed) {
      return;
    }
    await inject(FolderStore).deleteTag(item.name);
  }
);
