import * as vscode from 'vscode';
import { isFsAccessible } from '../../utils';

/**
 * Folders 视图的条目数据模型（Entry 词汇表）：类型、类型守卫、构造工厂与跨模块共享常量。
 * 独立成文件，让命令 / 拖拽 / Provider 依赖模型本身而非 Provider 实现，避免环依赖。
 */

/** 磁盘上真实存在的文件夹/文件节点 */
export interface NodeEntry {
  /** 判别字段：磁盘节点 */
  readonly kind: 'node';
  /** 节点资源的绝对 Uri */
  readonly uri: vscode.Uri;
  /** 资源类型（目录/文件），决定折叠态与图标 */
  readonly type: vscode.FileType;
  /** 仅根层级登记的文件夹/文件为 true，用于设置 contextValue 供右键菜单 when 过滤 */
  readonly managed?: true;
  /** 所属分组名（未分组为 undefined）；已分组条目的 contextValue 追加 .grouped 后缀供菜单过滤 */
  readonly group?: string;
  /** 标签列表（无标签为 undefined）；已加标签条目的 contextValue 追加 .tagged 后缀供菜单过滤 */
  readonly tags?: string[];
  /** 该渲染节点所在的标签组：仅标签模式下从标签节点子层级渲染时填充。纯拖拽上下文（不参与 TreeItem 渲染），
   *  随 DataTransfer 传到 handleDrop，实现「从哪个标签组拖出，就从哪个标签组移出」语义。 */
  readonly underTag?: string;
}

/** 空列表占位条目：点击即添加文件夹/文件 */
export interface PlaceholderEntry {
  /** 判别字段：空列表占位 */
  readonly kind: 'placeholder';
}

/** 目录在磁盘上已不存在时展示的失效占位条目 */
export interface MissingEntry {
  /** 判别字段：磁盘失效占位 */
  readonly kind: 'missing';
}

/** 资源当前不可访问时展示的占位条目（如远程未连接、虚拟文件系统提供程序缺失） */
export interface UnavailableEntry {
  /** 判别字段：资源不可访问占位 */
  readonly kind: 'unavailable';
  /** 不可访问的资源 Uri：单击占位行时据此发起打开/建连流程 */
  readonly uri: vscode.Uri;
}

/** 配置文件读取失败占位条目：JSON 语法/结构错误时整体替代树根，提示用户修复 */
export interface ConfigErrorEntry {
  /** 判别字段：配置文件错误占位 */
  readonly kind: 'configError';
}

/** 无效条目汇总占位：配置文件中存在无法渲染的条目（原样保留在文件中，仅不渲染） */
export interface InvalidEntriesEntry {
  /** 判别字段：无效条目汇总占位 */
  readonly kind: 'invalidEntries';
  /** 无效条目数量 */
  readonly count: number;
  /** 逐条 zod issue 文案（tooltip 展示用，渲染时截断） */
  readonly issues: readonly string[];
}

/** 分组节点：虚拟条目，名字即分组名（分组由条目 group 字段派生） */
export interface GroupEntry {
  /** 判别字段：分组节点 */
  readonly kind: 'group';
  /** 分组显示名（允许与「未分组」等虚拟节点同名，靠弱化着色区分） */
  readonly name: string;
}

/** 「未分组」虚拟分组：分组展示模式下收纳所有未分组条目（仅在存在未分组条目时显示） */
export interface UngroupedEntry {
  /** 判别字段：「未分组」虚拟分组 */
  readonly kind: 'ungrouped';
}

/** 标签节点：虚拟条目，名字即标签名（标签由条目 tags 字段派生）；同一条目可挂多个标签、出现在多个标签节点下 */
export interface TagEntry {
  /** 判别字段：标签节点 */
  readonly kind: 'tag';
  /** 标签显示名（允许与「未加标签」等虚拟节点同名，靠弱化着色区分） */
  readonly name: string;
}

/** 「未加标签」虚拟分组：标签展示模式下收纳所有无标签条目（仅在存在无标签条目时显示） */
export interface UntaggedEntry {
  /** 判别字段：「未加标签」虚拟分组 */
  readonly kind: 'untagged';
}

/** 树条目统一类型：磁盘节点 + 各类占位/虚拟节点（渲染与菜单按 kind 判别收窄） */
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

/** 标签图标：标签选择器中标签项的图标（tag 为标准 codicon） */
export const TAG_ICON = 'tag';

/**
 * 判断菜单或 inline 操作回传的值是否为已登记的文件或文件夹节点。
 * view/item/context 回传的是 getChildren 产生的 Entry，而不是渲染后的 TreeItem。
 *
 * @param value - 待判断的菜单回传参数（类型不透明，按 unknown 接收）
 * @returns 为 managed 的磁盘节点条目时为 true，并把 value 收窄为 {@link NodeEntry}
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
 * 判断菜单回传参数是否为分组节点（getChildren 返回的 GroupEntry，非 TreeItem）。
 *
 * @param value - 待判断的菜单回传参数
 * @returns 为分组节点时为 true，并把 value 收窄为 {@link GroupEntry}
 */
export function isGroupEntry(value: unknown): value is GroupEntry {
  return typeof value === 'object' && value !== null && (value as GroupEntry).kind === 'group';
}

/**
 * 判断菜单回传参数是否为标签节点（getChildren 返回的 TagEntry，非 TreeItem）。
 *
 * @param value - 待判断的菜单回传参数
 * @returns 为标签节点时为 true，并把 value 收窄为 {@link TagEntry}
 */
export function isTagEntry(value: unknown): value is TagEntry {
  return typeof value === 'object' && value !== null && (value as TagEntry).kind === 'tag';
}

/**
 * 登记条目 → 树节点工厂：stat 判定文件/目录类型；失效条目按目录兜底，
 * 展开时由 readDirectory 的失效处理展示占位项。
 *
 * @param uri - 条目资源 Uri
 * @param group - 所属分组名；undefined 表示未分组
 * @param tags - 标签列表；undefined 表示无标签
 * @param underTag - 渲染所在的标签组名（纯拖拽上下文，不参与渲染）；仅标签模式子层级传入
 * @returns managed 恒为 true 的树节点条目
 */
export async function toNodeEntry(uri: vscode.Uri, group?: string, tags?: string[], underTag?: string): Promise<NodeEntry> {
  let type = vscode.FileType.Directory;
  // 跨 authority 的远程资源不发起 stat：透传会读到错误机器的同名路径，按目录兜底，
  // 展开时由 getChildren 的守卫以「不可访问」占位呈现
  if (isFsAccessible(uri)) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      type = (stat.type & vscode.FileType.Directory) !== 0
        ? vscode.FileType.Directory
        : vscode.FileType.File;
    } catch {
      // stat 失败（已删除/移动）时按目录兜底，保持与既有失效文件夹一致的展示
    }
  }
  return { kind: 'node', uri, type, managed: true, group, tags, ...(underTag ? { underTag } : {}) };
}
