import { FolderStore } from '../../services/folderStore';
import { toNodeEntry } from './entries';
import type { Entry } from './entries';

/** 根层级构建策略：各展示模式自行构造树的根条目（空列表的占位提示由 Provider 统一兜底） */
export interface RootBuilder {
  buildRoot(): Promise<Entry[]>;
}

/** 平铺模式：全部登记条目直接列出（带分组与标签信息以驱动 contextValue ） */
export class FlatRootBuilder implements RootBuilder {
  constructor(private readonly folderStore: FolderStore) { }

  async buildRoot(): Promise<Entry[]> {
    const items = await this.folderStore.getAllWithMeta();
    return Promise.all(items.map((item) => toNodeEntry(item.uri, item.group, item.tags)));
  }
}

/** 分组模式：分组节点在前（按首次出现顺序），未分组作为一组收尾（存在未分组条目时才显示） */
export class GroupedRootBuilder implements RootBuilder {
  constructor(private readonly folderStore: FolderStore) { }

  async buildRoot(): Promise<Entry[]> {
    const [items, groups] = await Promise.all([
      this.folderStore.getAllWithMeta(),
      this.folderStore.getGroups(),
    ]);

    // 防御外部手改 config.json 导致的悬空分组名：视为未分组
    const known = new Set(groups);
    const groupEntries: Entry[] = groups.map((name) => ({ kind: 'group', name }));
    const hasUngrouped = items.some((item) => !item.group || !known.has(item.group));
    return hasUngrouped ? [...groupEntries, { kind: 'ungrouped' }] : groupEntries;
  }
}

/** 标签模式：标签节点在前（按首次出现顺序），「未加标签」收尾（存在无标签条目时才显示）。标签由条目派生，不存在悬空标签名 */
export class TaggedRootBuilder implements RootBuilder {
  constructor(private readonly folderStore: FolderStore) { }

  async buildRoot(): Promise<Entry[]> {
    const [items, tags] = await Promise.all([
      this.folderStore.getAllWithMeta(),
      this.folderStore.getTags(),
    ]);

    const tagEntries: Entry[] = tags.map((name) => ({ kind: 'tag', name }));
    const hasUntagged = items.some((item) => !item.tags?.length);
    return hasUntagged ? [...tagEntries, { kind: 'untagged' }] : tagEntries;
  }
}
