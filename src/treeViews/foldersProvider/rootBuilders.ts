import { FolderStore } from '../../services/folderStore';
import { toNodeEntry } from './entries';
import type { Entry } from './entries';

/**
 * 根层级构建策略：各展示模式自行构造树的根条目（空列表的占位提示由 Provider 统一兜底）。
 */
export interface RootBuilder {
  /**
   * 构造当前展示模式的根条目列表。
   *
   * @returns 根层级条目数组（可能为空，空时由 Provider 补占位项）
   */
  buildRoot(): Promise<Entry[]>;
}

/** 平铺模式：全部登记条目直接列出（带分组与标签信息以驱动 contextValue） */
export class FlatRootBuilder implements RootBuilder {
  /**
   * @param folderStore - 收藏列表存储服务
   */
  constructor(private readonly folderStore: FolderStore) { }

  /**
   * 构造平铺模式的根节点。
   *
   * @returns 全部登记条目（按登记顺序）
   */
  async buildRoot(): Promise<Entry[]> {
    const items = await this.folderStore.getAllWithMeta();
    return Promise.all(items.map((item) => toNodeEntry(item.uri, item.group, item.tags)));
  }
}

/** 分组模式：分组节点在前（按首次出现顺序），未分组作为一组收尾（存在未分组条目时才显示） */
export class GroupedRootBuilder implements RootBuilder {
  /**
   * @param folderStore - 收藏列表存储服务
   */
  constructor(private readonly folderStore: FolderStore) { }

  /**
   * 构造分组模式的根节点。
   *
   * @returns 分组节点在前；存在未分组条目时以「未分组」虚拟节点收尾
   */
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

/** 标签模式：标签节点在前，「未加标签」节点在存在无标签条目时收尾。 */
export class TaggedRootBuilder implements RootBuilder {
  /**
   * @param folderStore - 收藏列表存储服务
   */
  constructor(private readonly folderStore: FolderStore) { }

  /**
   * 构造标签模式的根节点。
   *
   * @returns 标签节点在前；存在无标签条目时以「未加标签」虚拟节点收尾
   */
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
