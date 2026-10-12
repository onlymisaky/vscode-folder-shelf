import * as vscode from 'vscode';
import * as path from 'node:path';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';
import { collectManagedUris } from './folderCommands';
import { TAG_ICON, isTagEntry } from '../treeViews/foldersProvider/entries';
import type { Entry } from '../treeViews/foldersProvider/entries';
import { confirmDanger, renameViaInputBox } from '../utils';

/** 未命中行的弱化图标色：与 description 灰字同色，弱化观感统一 */
const DIMMED_ICON_COLOR = new vscode.ThemeColor('descriptionForeground');

/**
 * 标签选择器的行对象：在 QuickPickItem 基础上挂真实标签名，
 * 未命中弱化行的名字在 description 中，不能靠 label 取名。
 */
type TagPickItem = vscode.QuickPickItem & {
  /** 行对应的真实标签名；创建项固定为空串（名字尚未生效，靠对象同一性单独识别） */
  readonly tagName: string;
};

/** 标签选择器中根据输入动态生成的创建项。 */
interface PendingTagCreation {
  /** 已去除首尾空白、等待创建的标签名 */
  readonly name: string;
  /** 显示在选择器首行的创建动作 */
  readonly item: TagPickItem;
}

/**
 * 显示支持创建标签的多选 QuickPick。现有标签按首次出现顺序排列并恢复当前勾选状态；
 * 输入新名称时提供创建项，创建后可继续选择。选择过程只维护本地草稿，确认时返回完整标签集，
 * 取消时不产生任何写操作。
 *
 * @param existingTags - 现有标签全集（按首次出现顺序），作为初始列表
 * @param currentTags - 预勾选集合（各目标条目标签的并集）
 * @param title - 对话框标题（须为已翻译文案）
 * @returns 确认的标签集合（空数组 = 清除全部标签）；Esc 取消返回 undefined
 */
function pickTags(
  existingTags: readonly string[],
  currentTags: readonly string[],
  title: string
): Promise<string[] | undefined> {
  const quickPick = vscode.window.createQuickPick<TagPickItem>();
  quickPick.canSelectMany = true;
  quickPick.title = title;
  quickPick.placeholder = vscode.l10n.t('Select or enter tag name');
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;

  // 勾选状态外置：Set 为唯一状态源；创建项勾选态单独跟踪（每次键入重建创建项对象）
  const checkedTags = new Set(currentTags);
  let createChecked = false;
  // 可增长的标签全集：连续创建的新标签即时入列（初始为打开时的全部现有标签）
  const knownTags = [...existingTags];
  // 待创建项：键入 trim 后非空且不是现有标签名时存在，label 含输入值以便辨识
  let pendingCreate: PendingTagCreation | undefined;
  // 正在重挂 items：重挂引发的选中事件与本地状态一致，忽略以免回环
  let remounting = false;

  /**
   * 根据查询词重建标签行，并恢复由本地集合维护的勾选状态。
   * 创建项在前，其后依次为命中标签和弱化的未命中标签；组内保持首次出现顺序。
   * 全部行使用 alwaysShow，因为扩展 API 已无法关闭内置过滤；命中片段由运行时自动高亮。
   *
   * @param query - 当前搜索文本；调用前已由输入事件统一去除首尾空白
   */
  const render = (query: string): void => {
    const lowerQuery = query.toLowerCase();
    const matched: TagPickItem[] = [];
    const unmatched: TagPickItem[] = [];
    for (const name of knownTags) {
      if (lowerQuery === '' || name.toLowerCase().includes(lowerQuery)) {
        matched.push({
          tagName: name,
          label: name,
          iconPath: new vscode.ThemeIcon(TAG_ICON),
          alwaysShow: true,
        });
      } else {
        unmatched.push({
          tagName: name,
          label: '',
          iconPath: new vscode.ThemeIcon(TAG_ICON, DIMMED_ICON_COLOR),
          description: name,
          alwaysShow: true,
        });
      }
    }
    const tagItems = [...matched, ...unmatched];
    remounting = true;
    quickPick.items = pendingCreate ? [pendingCreate.item, ...tagItems] : tagItems;
    // 勾选态恢复：item.picked 仅 showQuickPick 生效，createQuickPick 必须经 selectedItems 设置；
    // 处于 remounting 守卫内，本次程序化设置不会触发状态同步
    const restore = tagItems.filter((item) => checkedTags.has(item.tagName));
    if (pendingCreate !== undefined && createChecked) {
      restore.push(pendingCreate.item);
    }
    quickPick.selectedItems = restore;
    remounting = false;
  };

  // 用户勾选/取消 → 同步进本地状态（创建项 tagName 为空串被排除，按对象同一性单独识别）
  quickPick.onDidChangeSelection((selected) => {
    if (remounting) {
      return;
    }
    // 恒等替换：勾选全集即本次选中集（全部行恒可见，无需与旧集合做差集）
    checkedTags.clear();
    for (const item of selected) {
      if (item.tagName !== '') {
        checkedTags.add(item.tagName);
      }
    }
    createChecked = pendingCreate !== undefined && selected.includes(pendingCreate.item);
  });

  quickPick.onDidChangeValue((value) => {
    const trimmed = value.trim();
    const nextCreate =
      trimmed === '' || knownTags.includes(trimmed)
        ? undefined
        : {
            name: trimmed,
            item: {
              tagName: '',
              // label 必须精确等于输入词：内置过滤按模糊得分重排，精确匹配得分恒最高，
              // 从而把创建项钉在列表第一位（动作项不应随得分浮动）；提示降级为灰字 description
              label: trimmed,
              description: vscode.l10n.t('Create tag'),
              iconPath: new vscode.ThemeIcon('plus'),
              alwaysShow: true,
            },
          };
    // 创建项从有到无时重置勾选态；持续键入（有到有）则保留，用户可边输入边勾选
    if (nextCreate === undefined || pendingCreate === undefined) {
      createChecked = false;
    }
    pendingCreate = nextCreate;
    render(trimmed);
  });

  // 首次渲染：show 前必须先挂 items，否则列表为空直到键入触发 onDidChangeValue
  render('');

  return new Promise<string[] | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      // 勾选创建项回车 = 创建并继续：新标签即时入列并勾选、输入框清空、对话框保持打开；
      // 未勾选创建项（或无创建项）回车 = 确认收尾，一次性返回结果
      if (pendingCreate !== undefined && createChecked) {
        const name = pendingCreate.name;
        knownTags.push(name);
        checkedTags.add(name);
        createChecked = false;
        pendingCreate = undefined;
        quickPick.value = '';
        // 不依赖 value 赋值是否回触发 onDidChangeValue，显式重渲染
        render('');
        return;
      }
      resolve([...checkedTags]);
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(undefined);
    });
    quickPick.show();
  });
}

/**
 * 标签命令共享流程：解析目标（支持多选）→ 以各条目标签的并集预勾选 → 多选 QuickPick
 * （添加标签与管理标签界面完全相同，仅标题不同）→ 确认后以 replace 语义写入全部目标。
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

  // 标题显示待操作条目名单，让操作对象一目了然
  const names = targets.map((uri) => path.basename(uri.fsPath));
  const result = await pickTags(existingTags, currentTags, buildTitle(names.join(', ')));
  if (result === undefined) {
    return;
  }

  await folderStore.setItemTags(targets, result);
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
