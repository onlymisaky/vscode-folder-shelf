import * as vscode from 'vscode';
import { FolderStore } from '../../services/folderStore';
import { collectManagedUris } from '../../commands/folderCommands';
import { isManagedEntry } from './entries';
import type { Entry } from './entries';

/** 树内拖拽使用的 MIME 类型（约定为树 id 的小写形式） */
const TREE_MIME_TYPE = 'application/vnd.code.tree.foldershelf.views.folders';

/**
 * 收藏树的拖拽控制器：
 * - 拖拽登记条目（文件夹/文件）到分组节点 → 归入该分组
 * - 拖到视图空白区（target 为 undefined）→ 移出分组
 * - 拖到具体条目上不处理（不做磁盘移动/排序）
 */
export class FoldersDragAndDropController implements vscode.TreeDragAndDropController<Entry> {
  readonly dropMimeTypes = [TREE_MIME_TYPE];
  readonly dragMimeTypes = [TREE_MIME_TYPE];

  constructor(private readonly folderStore: FolderStore) { }

  handleDrag(source: readonly Entry[], dataTransfer: vscode.DataTransfer): void {
    // 仅登记的根层级条目（managed）可拖拽分组
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
    const uris = collectManagedUris(undefined, source as Entry[]);
    if (uris.length === 0) {
      return;
    }

    if (target?.kind === 'group') {
      await this.folderStore.setItemGroups(uris, target.name);
    } else if (target === undefined || target.kind === 'ungrouped') {
      // 拖到空白区或「未分组」节点：移出分组
      await this.folderStore.setItemGroups(uris, undefined);
    }
  }
}
