import { FolderStore } from '../../services/folderStore';
import { toNodeEntry } from './entries';
import type { Entry } from './entries';

/**
 * 构造不同视图模式的根节点；空列表占位项由数据源统一添加。
 */
export interface RootBuilder {
  /**
   * 构造当前展示模式的根条目列表。
   *
   * @returns 根节点数组；没有条目时为空数组
   */
  buildRoot(): Promise<Entry[]>;
}

export class FlatRootBuilder implements RootBuilder {
  constructor(private readonly folderStore: FolderStore) { }

  async buildRoot(): Promise<Entry[]> {
    const items = await this.folderStore.getAllWithMeta();
    return Promise.all(items.map((item) => toNodeEntry(item.uri, item.group, item.tags)));
  }
}

export class GroupedRootBuilder implements RootBuilder {
  constructor(private readonly folderStore: FolderStore) { }

  async buildRoot(): Promise<Entry[]> {
    const [items, groups] = await Promise.all([
      this.folderStore.getAllWithMeta(),
      this.folderStore.getGroups(),
    ]);

    const groupEntries: Entry[] = groups.map((name) => ({ kind: 'group', name }));
    const hasUngrouped = items.some((item) => !item.group);
    return hasUngrouped ? [...groupEntries, { kind: 'ungrouped' }] : groupEntries;
  }
}

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
