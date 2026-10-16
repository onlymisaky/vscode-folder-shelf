import * as vscode from 'vscode';
import { ConfigFileError } from '../../services/configFileError';
import { FolderStore } from '../../services/folderStore';
import type { ItemTagUpdate } from '../../services/folderStore';
import { reportConfigFileError } from '../../utils';
import { SETTING_DRAG_TO_TAG, SETTING_SECTION } from '../../settings';
import { isManagedEntry } from './entries';
import type { Entry, NodeEntry, TagEntry } from './entries';

/** 树内部拖放数据使用的 MIME 类型。 */
const TREE_MIME_TYPE = 'application/vnd.code.tree.foldershelf.views.folders';

/** 已带标签的条目拖到另一标签时所用的行为设置。 */
type DragToTagAction = 'alwaysAsk' | 'removeCurrent' | 'keepCurrent';

/** 已至少包含一个标签的登记节点。 */
type TaggedNodeEntry = NodeEntry & {
  /** 至少包含一个值的标签数组。 */
  readonly tags: string[];
};

/**
 * 处理树内部拖放。分组节点用于设置分组，空白区域和“未分组”节点用于移出分组，
 * 标签节点用于添加或迁移标签，“未加标签”节点用于清空标签。拖到文件系统节点不会
 * 移动磁盘内容或改变排序。
 */
export class FoldersDragAndDropController implements vscode.TreeDragAndDropController<Entry> {
  /** 本控制器接受的内部拖放 MIME 类型。 */
  readonly dropMimeTypes = [TREE_MIME_TYPE];
  /** 拖出时写入的 MIME 类型，其值为受管理节点数组。 */
  readonly dragMimeTypes = [TREE_MIME_TYPE];

  /**
   * 创建树拖放控制器。
   *
   * @param folderStore - 保存拖放结果的列表存储服务
   */
  constructor(private readonly folderStore: FolderStore) { }

  /**
   * 将拖拽的受管理节点写入 `DataTransfer`。
   *
   * @param source - 被拖拽的条目；非受管理节点会被过滤
   * @param dataTransfer - 接收内部节点数组的拖放数据容器
   */
  handleDrag(source: readonly Entry[], dataTransfer: vscode.DataTransfer): void {
    // 标签模式下保留 `parentTag`，供放下时识别条目原来所在的标签节点。
    const entries = source.filter(isManagedEntry);
    if (entries.length > 0) {
      // 同一棵树内可直接从 DataTransferItem.value 取回节点对象。
      dataTransfer.set(TREE_MIME_TYPE, new vscode.DataTransferItem(entries));
    }
  }

  /**
   * 根据放置目标更新分组或标签。放到文件系统节点时不执行任何操作。
   *
   * @param target - 放置目标；`undefined` 表示视图空白区域
   * @param dataTransfer - 包含内部节点数组的拖放数据容器
   * @returns 表示存储已更新或错误提示已完成的 Promise
   */
  async handleDrop(
    target: Entry | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    const transfer = dataTransfer.get(TREE_MIME_TYPE);
    const source = Array.isArray(transfer?.value) ? (transfer.value as unknown[]) : [];
    const entries = source.filter(isManagedEntry);
    const uris = entries.map((entry) => entry.uri);
    if (uris.length === 0) {
      return;
    }

    try {
      if (target?.kind === 'group') {
        await this.folderStore.setItemGroups(uris, target.name);
      } else if (target?.kind === 'tag') {
        await this.dropOnTag(target, entries);
      } else if (target?.kind === 'untagged') {
        // “未加标签”节点表示清空所有标签。
        await this.folderStore.setItemTags(uris, undefined);
      } else if (target === undefined || target.kind === 'ungrouped') {
        // 空白区域和“未分组”节点都表示移出分组。
        await this.folderStore.setItemGroups(uris, undefined);
      }
    } catch (error) {
      // 配置无效时保留原文件，并向用户显示修复入口。
      if (error instanceof ConfigFileError) {
        await reportConfigFileError(error);
        return;
      }
      throw error;
    }
  }

  /**
   * 将条目拖到标签节点。无标签条目直接添加目标标签；已有标签的条目根据设置保留
   * 原标签、移除拖出位置对应的标签，或弹窗询问。所有变化一次写入存储。
   *
   * @param target - 目标标签节点
   * @param entries - 被拖拽的受管理节点
   * @returns 表示标签更新完成的 Promise
   */
  private async dropOnTag(target: TagEntry, entries: readonly NodeEntry[]): Promise<void> {
    const tagged = entries.filter(
      (entry): entry is TaggedNodeEntry => (entry.tags?.length ?? 0) > 0
    );
    const updates: ItemTagUpdate[] = [];

    // 无标签条目可以直接添加目标标签。
    for (const entry of entries) {
      if (!entry.tags?.length) {
        updates.push({ uri: entry.uri, tags: [target.name] });
      }
    }

    // 已带标签的条目按用户设置处理。
    let action: 'remove' | 'keep' | undefined;
    const setting = vscode.workspace
      .getConfiguration(SETTING_SECTION)
      .get<DragToTagAction>(SETTING_DRAG_TO_TAG, 'alwaysAsk');
    if (setting === 'removeCurrent') {
      action = 'remove';
    } else if (setting === 'keepCurrent') {
      action = 'keep';
    } else if (tagged.length > 0) {
      // 只为已有标签的条目询问一次；关闭弹窗表示不更新这些条目。
      const REMOVE: vscode.MessageItem = {
        title: vscode.l10n.t('Remove original tag, then add "{0}"', target.name),
      };
      const KEEP: vscode.MessageItem = {
        title: vscode.l10n.t('Keep original tags, then add "{0}"', target.name),
      };
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          '{0} of the selected items already belong to other tags. When adding tag "{1}":',
          tagged.length,
          target.name
        ),
        { modal: true },
        REMOVE,
        KEEP
      );
      if (choice === REMOVE) {
        action = 'remove';
      } else if (choice === KEEP) {
        action = 'keep';
      }
    }

    for (const entry of tagged) {
      // 只有标签模式提供 `parentTag`；缺少该信息时保留原标签。
      if (action === 'remove' && entry.parentTag) {
        // 移除拖出位置对应的标签，再添加目标标签并去重。
        const kept = entry.tags.filter((tag) => tag !== entry.parentTag);
        updates.push({
          uri: entry.uri,
          tags: kept.includes(target.name) ? kept : [...kept, target.name],
        });
      } else if (action === 'keep' || action === 'remove') {
        // 保留现有标签，并在尚未包含目标标签时添加它。
        updates.push({
          uri: entry.uri,
          tags: entry.tags.includes(target.name) ? entry.tags : [...entry.tags, target.name],
        });
      }
    }

    if (updates.length > 0) {
      await this.folderStore.applyItemTags(updates);
    }
  }
}
