import * as vscode from 'vscode';
import { FolderStore } from '../../services/folderStore';
import { isManagedEntry } from './entries';
import type { Entry, NodeEntry, TagEntry } from './entries';

/** 树内拖拽使用的 MIME 类型（约定为树 id 的小写形式） */
const TREE_MIME_TYPE = 'application/vnd.code.tree.foldershelf.views.folders';

/** 设置段与设置键：拖到标签节点时对已加标签条目的处理方式 */
const SETTING_SECTION = 'folderShelf';
const SETTING_DRAG_TO_TAG = 'dragToTagAction';

/** 拖到标签节点时的处理方式：始终询问 / 从当前标签移出 / 保留现有标签 */
type DragToTagAction = 'alwaysAsk' | 'removeCurrent' | 'keepCurrent';

/**
 * 收藏树的拖拽控制器：
 * - 拖拽登记条目（文件夹/文件）到分组节点 → 归入该分组
 * - 拖到视图空白区（target 为 undefined）→ 移出分组
 * - 拖到「未分组」节点 → 移出分组；拖到「未加标签」节点 → 清除全部标签（处理逻辑同「未分组」一致）
 * - 拖到标签节点 → 无标签条目直接新增该标签；已加标签条目按设置处理（默认弹窗询问）：
 *   「当前标签」指条目被拖出所在的标签组（由渲染时挂在 NodeEntry 上的 underTag 随拖拽传出）
 * - 拖到具体条目上不处理（不做磁盘移动/排序）
 */
export class FoldersDragAndDropController implements vscode.TreeDragAndDropController<Entry> {
  readonly dropMimeTypes = [TREE_MIME_TYPE];
  readonly dragMimeTypes = [TREE_MIME_TYPE];

  constructor(private readonly folderStore: FolderStore) { }

  handleDrag(source: readonly Entry[], dataTransfer: vscode.DataTransfer): void {
    // 仅登记的根层级条目（managed）可拖拽分组；标签模式下子层级渲染的 NodeEntry 带 underTag 一并传出
    const entries = source.filter(isManagedEntry);
    if (entries.length > 0) {
      // 树内拖拽的 DataTransferItem.value 可直接回读对象（跨树/外部拖拽无该 MIME）
      dataTransfer.set(TREE_MIME_TYPE, new vscode.DataTransferItem(entries));
    }
  }

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

    if (target?.kind === 'group') {
      await this.folderStore.setItemGroups(uris, target.name);
    } else if (target?.kind === 'tag') {
      await this.dropOnTag(target, entries);
    } else if (target?.kind === 'untagged') {
      // 拖到「未加标签」节点：清除全部标签（与「未分组」节点的移出分组对等）
      await this.folderStore.setItemTags(uris, undefined);
    } else if (target === undefined || target.kind === 'ungrouped') {
      // 拖到空白区或「未分组」节点：移出分组
      await this.folderStore.setItemGroups(uris, undefined);
    }
  }

  /**
   * 拖到标签节点：无标签条目直接新增该标签（规则1）；已加标签条目（规则2）按设置
   * dragToTagAction 决定动作——「从当前标签移出」保留其余标签、移出被拖出的标签组；
   * 「保留现有标签」原样追加；「始终询问」弹模态确认，取消则仅放弃已加标签条目的处理。
   * 混合拖拽一次询问，动作按各自 underTag 独立执行；整批经 applyItemTags 单次写盘。
   */
  private async dropOnTag(target: TagEntry, entries: readonly NodeEntry[]): Promise<void> {
    const tagged = entries.filter(
      (entry): entry is NodeEntry & { tags: string[] } => (entry.tags?.length ?? 0) > 0
    );
    const updates: Array<{ uri: vscode.Uri; tags: string[] }> = [];

    // 规则1：无标签条目直接新增（无需确认）
    for (const entry of entries) {
      if (!entry.tags?.length) {
        updates.push({ uri: entry.uri, tags: [target.name] });
      }
    }

    // 规则2：已加标签条目按设置决定动作
    let action: 'remove' | 'keep' | undefined;
    const setting = vscode.workspace
      .getConfiguration(SETTING_SECTION)
      .get<DragToTagAction>(SETTING_DRAG_TO_TAG, 'alwaysAsk');
    if (setting === 'removeCurrent') {
      action = 'remove';
    } else if (setting === 'keepCurrent') {
      action = 'keep';
    } else if (tagged.length > 0) {
      // 始终询问：仅存在已加标签条目时才有得问；取消 = 放弃对这批条目的处理。
      // 按钮直接写出动作结果（移出/保留 + 是否加入新标签），避免「当前标签」类术语造成歧义
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
      // 移出条件双保险：动作为移出且条目确有拖出标签组（underTag 缺失时按保留兜底）
      if (action === 'remove' && entry.underTag) {
        // 移出所在标签组：保留其余标签 ∪ 新标签（新标签已在其中则仅移出）
        const kept = entry.tags.filter((tag) => tag !== entry.underTag);
        updates.push({
          uri: entry.uri,
          tags: kept.includes(target.name) ? kept : [...kept, target.name],
        });
      } else if (action === 'keep' || action === 'remove') {
        // 保留现有标签：现有集合 ∪ 新标签（去重）
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
