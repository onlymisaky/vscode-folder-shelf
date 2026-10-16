import * as vscode from 'vscode';
import { isFsAccessible } from '../../utils';

type EntryKind = 'node' | 'placeholder' | 'missing' | 'unavailable' | 'configError' | 'invalidEntries' | 'group' | 'ungrouped' | 'tag' | 'untagged';

export type EntryKindMap = { [K in EntryKind]: K };

/** 文件系统中的目录或文件节点 */
export interface NodeEntry {
  readonly kind: EntryKindMap['node'];
  /** 节点资源的绝对 Uri */
  readonly uri: vscode.Uri;
  /** 资源类型，用于确定折叠状态和图标 */
  readonly type: vscode.FileType;
  /** 根层级登记的文件或目录为 `true`，用于启用条目菜单 */
  readonly managed?: true;
  /** 所属分组名；`undefined` 表示未分组 */
  readonly group?: string;
  /** 标签列表；`undefined` 表示无标签 */
  readonly tags?: string[];
  /** 标签模式下该节点所在父标签的名称，仅供拖放时确定需要移除的原标签 */
  readonly parentTag?: string;
}

/** 空列表中显示的可点击占位条目 */
export interface PlaceholderEntry {
  readonly kind: EntryKindMap['placeholder'];
}

/** 目录已不存在时显示的占位条目 */
export interface MissingEntry {
  readonly kind: EntryKindMap['missing'];
}

/** 远程未连接或文件系统提供程序不可用时显示的占位条目 */
export interface UnavailableEntry {
  readonly kind: EntryKindMap['unavailable'];
  /** 当前不可访问的资源 URI */
  readonly uri: vscode.Uri;
}

/** 配置文件存在语法或结构错误时显示的根占位条目 */
export interface ConfigErrorEntry {
  readonly kind: EntryKindMap['configError'];
}

/** 汇总配置文件中无法渲染但仍原样保留的条目 */
export interface InvalidEntriesEntry {
  readonly kind: EntryKindMap['invalidEntries'];
  /** 无效条目数量 */
  readonly count: number;
  /** 各条目的 Zod 问题文本，显示时可能截断 */
  readonly issues: readonly string[];
}

/** 从条目 `group` 字段生成的虚拟分组节点 */
export interface GroupEntry {
  readonly kind: EntryKindMap['group'];
  /** 分组显示名；可与“未分组”虚拟节点同名 */
  readonly name: string;
}

/** 分组模式下包含所有未分组条目的虚拟节点 */
export interface UngroupedEntry {
  readonly kind: EntryKindMap['ungrouped'];
}

/** 从条目 `tags` 字段生成的虚拟标签节点 */
export interface TagEntry {
  readonly kind: EntryKindMap['tag'];
  /** 标签显示名；可与“未加标签”虚拟节点同名 */
  readonly name: string;
}

/** 标签模式下包含所有无标签条目的虚拟节点 */
export interface UntaggedEntry {
  readonly kind: EntryKindMap['untagged'];
}

/** 树中磁盘节点、虚拟分组和占位节点的联合类型 */
export type Entry =
  | NodeEntry
  | PlaceholderEntry
  | MissingEntry
  | UnavailableEntry
  | ConfigErrorEntry
  | InvalidEntriesEntry
  | GroupEntry
  | UngroupedEntry
  | TagEntry
  | UntaggedEntry;

/** 分组节点使用的 Codicon 名称 */
export const GROUP_ICON = 'library';

/** 标签节点和标签选择项使用的 Codicon 名称 */
export const TAG_ICON = 'tag';

/**
 * “未分组”和“未加标签”节点使用的虚拟 URI 协议，仅用于应用文件装饰，
 * 不对应真实文件系统资源
 */
export const UNGROUPED_SCHEME = 'folderShelf-ungrouped';
export const UNTAGGED_SCHEME = 'folderShelf-untagged';

/**
 * 判断命令参数是否为已登记的文件或目录节点
 *
 * @param value - 菜单或行内操作传入的值
 * @returns 值为受管理的磁盘节点时为 `true`
 */
export function isManagedEntry(value: unknown): value is NodeEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as NodeEntry).kind === 'node' &&
    (value as NodeEntry).managed === true
  );
}

/**
 * 判断命令参数是否为分组节点
 *
 * @param value - 菜单传入的值
 * @returns 值为分组节点时为 `true`
 */
export function isGroupEntry(value: unknown): value is GroupEntry {
  return typeof value === 'object' && value !== null && (value as GroupEntry).kind === 'group';
}

/**
 * 判断命令参数是否为标签节点
 *
 * @param value - 菜单传入的值
 * @returns 值为标签节点时为 `true`
 */
export function isTagEntry(value: unknown): value is TagEntry {
  return typeof value === 'object' && value !== null && (value as TagEntry).kind === 'tag';
}

/**
 * 将登记条目转换为树节点无法读取资源类型时暂按目录处理，展开时再由数据源
 * 显示“缺失”或“不可访问”占位项
 *
 * @param uri - 条目的资源 URI
 * @param group - 所属分组名；`undefined` 表示未分组
 * @param tags - 标签列表；`undefined` 表示无标签
 * @param parentTag - 标签模式下节点所在父标签的名称
 * @returns `managed` 为 `true` 的树节点
 */
export async function toNodeEntry(uri: vscode.Uri, group?: string, tags?: string[], parentTag?: string): Promise<NodeEntry> {
  let type = vscode.FileType.Directory;
  // 不读取其他远程连接的资源，防止当前连接按相同路径访问错误的远程主机
  if (isFsAccessible(uri)) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      type = (stat.type & vscode.FileType.Directory) !== 0
        ? vscode.FileType.Directory
        : vscode.FileType.File;
    } catch {
      // 无法确定类型时暂按目录显示，展开后会给出具体的不可访问提示
    }
  }
  return { 
    kind: 'node', 
    uri, 
    type,
    managed: true,
    group,
    tags,
    ...(parentTag ? { parentTag } : {}) };
}
