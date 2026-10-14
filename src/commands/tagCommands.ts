import * as vscode from 'vscode';
import * as path from 'node:path';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';
import { collectManagedUris } from './folderCommands';
import { TAG_ICON, isTagEntry } from '../treeViews/foldersProvider/entries';
import type { Entry } from '../treeViews/foldersProvider/entries';
import { confirmDanger, renameViaInputBox, showPicker } from '../utils';

/**
 * 标签选择器的行对象：在 QuickPickItem 基础上挂真实标签名，
 * 结果按行对象回传后经 tagName 取回标签名。
 */
type TagPickItem = vscode.QuickPickItem & {
  /** 行对应的真实标签名 */
  readonly tagName: string;
};

/**
 * 标签命令共享流程：解析目标（支持多选）→ 以各条目标签的并集预勾选 → 多选 QuickPick
 * （添加标签与管理标签界面完全相同，仅标题不同；showPicker 支持键入即建、创建后继续选）
 * → 确认后以 replace 语义写入全部目标。
 * 全不勾选确认即清除所选条目的全部标签；集合无实际变化时 store 层不写盘、不触发刷新。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的 selection 数组
 * @param buildTitle - 标题构造器：入参为待操作条目名（逗号连接），返回已翻译标题文案
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
  const tagsByPath = new Map(allMeta.map((meta) => [meta.uri.fsPath, meta.tags]));
  // 预勾选 = 所有选中条目标签的并集（单选即该条目自身标签），避免「未编辑直接确认」误清空
  const currentTags = [...new Set(targets.flatMap((uri) => tagsByPath.get(uri.fsPath) ?? []))];

  // 行全集：行对象挂 tagName，结果按行对象回传后取回标签名；预勾选直接传名字集合（label 即名字域）
  const items: TagPickItem[] = existingTags.map((name) => ({
    tagName: name,
    label: name,
    iconPath: new vscode.ThemeIcon(TAG_ICON),
  }));

  // 标题显示待操作条目名单，让操作对象一目了然
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
 * 添加标签：未加标签条目的右键菜单项（与「管理标签」共用同一多选 QuickPick，仅标题不同）。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的 selection 数组
 */
export const ADD_TAG_COMMAND = defineCommand(
  'folderShelf.addTag',
  async (item?: Entry, selectedItems?: readonly Entry[]): Promise<void> => {
    await pickAndSetTags(item, selectedItems, (names) => vscode.l10n.t('Add Tags to {0}', names));
  }
);

/**
 * 管理标签：已加标签条目的右键菜单项（与「添加标签」共用同一多选 QuickPick，仅标题不同）。
 *
 * @param item - 触发菜单的树条目
 * @param selectedItems - 多选时的 selection 数组
 */
export const MANAGE_TAGS_COMMAND = defineCommand(
  'folderShelf.manageTags',
  async (item?: Entry, selectedItems?: readonly Entry[]): Promise<void> => {
    await pickAndSetTags(item, selectedItems, (names) => vscode.l10n.t('Manage Tags for {0}', names));
  }
);

/**
 * 重命名标签：批量改写所有持有该标签条目的 tags 字段。目标取右键回传的标签节点。
 *
 * @param item - 触发菜单的树条目（须为标签节点，否则忽略）
 */
export const RENAME_TAG_COMMAND = defineCommand(
  'folderShelf.renameTag',
  async (item?: Entry): Promise<void> => {
    if (!isTagEntry(item)) {
      return;
    }
    await renameViaInputBox(
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
 * 删除标签：确认后从所有持有该标签的条目中移除（条目本身保留）。目标取右键回传的标签节点。
 *
 * @param item - 触发菜单的树条目（须为标签节点，否则忽略）
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
