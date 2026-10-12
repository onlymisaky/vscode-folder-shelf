import * as vscode from 'vscode';

/**
 * Folders 视图的条目数据模型（Entry 词汇表）：类型、类型守卫、构造工厂与跨模块共享常量。
 * 独立成文件，让命令 / 拖拽 / Provider 依赖模型本身而非 Provider 实现，避免环依赖。
 */

export interface NodeEntry {
  readonly kind: 'node';
  readonly uri: vscode.Uri;
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

export interface PlaceholderEntry {
  readonly kind: 'placeholder';
}

/** 目录在磁盘上已不存在时展示的失效占位条目 */
export interface MissingEntry {
  readonly kind: 'missing';
}

/** 分组节点：虚拟条目，名字即分组名（分组由条目 group 字段派生） */
export interface GroupEntry {
  readonly kind: 'group';
  readonly name: string;
}

/** 「未分组」虚拟分组：分组展示模式下收纳所有未分组条目（仅在存在未分组条目时显示） */
export interface UngroupedEntry {
  readonly kind: 'ungrouped';
}

/** 标签节点：虚拟条目，名字即标签名（标签由条目 tags 字段派生）；同一条目可挂多个标签、出现在多个标签节点下 */
export interface TagEntry {
  readonly kind: 'tag';
  readonly name: string;
}

/** 「未加标签」虚拟分组：标签展示模式下收纳所有无标签条目（仅在存在无标签条目时显示） */
export interface UntaggedEntry {
  readonly kind: 'untagged';
}

export type Entry =
  | NodeEntry
  | PlaceholderEntry
  | MissingEntry
  | GroupEntry
  | UngroupedEntry
  | TagEntry
  | UntaggedEntry;

/** 分组节点图标（已验证本机 codicon.ttf 含该字形） */
export const GROUP_ICON = 'library';

/** 标签图标：标签选择器中标签项的图标（tag 为标准 codicon） */
export const TAG_ICON = 'tag';

/**
 * 判断菜单/inline 回传参数是否为登记的根文件夹元素。
 * 实测（Trae CN，VSCode 分支同源）：view/item/context 与 inline 菜单回传的是
 * getChildren 返回的元素本身（Entry），而非 TreeItem，故直接按类型收窄。
 */
export function isManagedEntry(value: unknown): value is NodeEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as NodeEntry).kind === 'node' &&
    (value as NodeEntry).managed === true
  );
}

/** 判断菜单回传参数是否为分组节点（getChildren 返回的 GroupEntry，非 TreeItem） */
export function isGroupEntry(value: unknown): value is GroupEntry {
  return typeof value === 'object' && value !== null && (value as GroupEntry).kind === 'group';
}

/** 判断菜单回传参数是否为标签节点（getChildren 返回的 TagEntry，非 TreeItem） */
export function isTagEntry(value: unknown): value is TagEntry {
  return typeof value === 'object' && value !== null && (value as TagEntry).kind === 'tag';
}

/** 登记条目 → 树节点：stat 判定文件/目录类型；失效条目按目录兜底，展开时由 readDirectory 的失效处理展示占位项。underTag 仅标签模式子层级填充（拖拽上下文） */
export async function toNodeEntry(uri: vscode.Uri, group?: string, tags?: string[], underTag?: string): Promise<NodeEntry> {
  let type = vscode.FileType.Directory;
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    type = (stat.type & vscode.FileType.Directory) !== 0
      ? vscode.FileType.Directory
      : vscode.FileType.File;
  } catch {
    // stat 失败（已删除/移动）时按目录兜底，保持与既有失效文件夹一致的展示
  }
  return { kind: 'node', uri, type, managed: true, group, tags, ...(underTag ? { underTag } : {}) };
}
