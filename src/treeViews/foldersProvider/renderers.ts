import * as vscode from 'vscode';
import { ADD_ITEM_COMMAND, OPEN_CONFIG_FILE_COMMAND, OPEN_FILE_COMMAND } from '../../commands';
import { isFsAccessible } from '../../utils';
import { GROUP_ICON, TAG_ICON, UNGROUPED_SCHEME, UNTAGGED_SCHEME } from './entries';
import type { Entry, GroupEntry, InvalidEntriesEntry, NodeEntry, TagEntry } from './entries';

/**
 * 将各类 {@link Entry} 转换为 `TreeItem`。映射类型要求每种 `kind` 都有对应渲染器。
 */

/** 单个条目种类的渲染函数签名。 */
type EntryRenderer<K extends Entry['kind']> = (entry: Extract<Entry, { kind: K }>) => vscode.TreeItem;

/** 必须覆盖全部条目种类的渲染器表。 */
export type Renderers = { [K in Entry['kind']]: EntryRenderer<K> };

/** “未分组”节点用于应用文件装饰的固定 URI。 */
const UNGROUPED_RESOURCE = vscode.Uri.from({ scheme: UNGROUPED_SCHEME, path: '/ungrouped' });
/** “未加标签”节点用于应用文件装饰的固定 URI。 */
const UNTAGGED_RESOURCE = vscode.Uri.from({ scheme: UNTAGGED_SCHEME, path: '/untagged' });

/** 无效条目提示中最多显示的 Zod 问题数。 */
const MAX_SHOWN_ISSUES = 5;

/**
 * 创建不可折叠的占位树项。
 *
 * @param label - 显示文本
 * @param icon - Codicon 名称
 * @param tooltip - 可选的悬停提示
 * @returns 创建的占位树项
 */
function placeholderItem(label: string, icon: string, tooltip?: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon(icon);
  if (tooltip !== undefined) {
    item.tooltip = tooltip;
  }
  return item;
}

/**
 * 创建空列表占位项，并绑定添加条目命令。
 *
 * @returns 可点击的空列表占位项
 */
function renderPlaceholder(): vscode.TreeItem {
  const item = placeholderItem(vscode.l10n.t('No items added yet. Click to add one.'), 'add');
  item.command = ADD_ITEM_COMMAND.treeItemCommand(vscode.l10n.t('Add'));
  return item;
}

/**
 * 创建资源已不存在的占位项。
 *
 * @returns 缺失资源占位项
 */
function renderMissing(): vscode.TreeItem {
  return placeholderItem(vscode.l10n.t('Item is missing on disk'), 'warning');
}

/**
 * 创建资源暂时不可访问的占位项，例如远程连接未建立或文件系统提供程序不可用。
 *
 * @returns 不可访问资源占位项
 */
function renderUnavailable(): vscode.TreeItem {
  return placeholderItem(vscode.l10n.t('Item is currently unavailable'), 'warning');
}

/**
 * 创建配置文件错误占位项，并绑定打开配置文件命令。
 *
 * @returns 可点击的配置错误占位项
 */
function renderConfigError(): vscode.TreeItem {
  const item = placeholderItem(
    vscode.l10n.t('Config file error'),
    'error',
    vscode.l10n.t('The config file failed to load. Click to open it and fix the problem.')
  );
  item.command = OPEN_CONFIG_FILE_COMMAND.treeItemCommand(vscode.l10n.t('Open Config File'));
  return item;
}

/**
 * 创建无效配置条目的汇总占位项。
 *
 * @param element - 无效条目的数量和问题列表
 * @returns 带截断问题列表的占位项
 */
function renderInvalidEntries(element: InvalidEntriesEntry): vscode.TreeItem {
  const shown = element.issues.slice(0, MAX_SHOWN_ISSUES);
  const rest = element.issues.length - shown.length;
  return placeholderItem(
    vscode.l10n.t('{0} invalid item(s) kept in the config file', element.count),
    'warning',
    [
      vscode.l10n.t('Invalid items are kept in the config file unchanged:'),
      ...shown,
      ...(rest > 0 ? [vscode.l10n.t('…and {0} more', rest)] : []),
    ].join('\n')
  );
}

/**
 * 创建可折叠的分组节点。
 *
 * @param element - 分组条目
 * @returns 带分组菜单上下文的树项
 */
function renderGroup(element: GroupEntry): vscode.TreeItem {
  const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
  item.iconPath = new vscode.ThemeIcon(GROUP_ICON);
  item.contextValue = 'folders.group';
  return item;
}

/**
 * 创建“未分组”虚拟节点。该节点不设置菜单上下文，并通过资源 URI 应用弱化装饰。
 *
 * @returns “未分组”树项
 */
function renderUngrouped(): vscode.TreeItem {
  const item = new vscode.TreeItem(
    vscode.l10n.t('Ungrouped'),
    vscode.TreeItemCollapsibleState.Collapsed
  );
  item.resourceUri = UNGROUPED_RESOURCE;
  item.iconPath = new vscode.ThemeIcon(GROUP_ICON);
  item.tooltip = vscode.l10n.t('Virtual group collecting items not assigned to any group.');
  return item;
}

/**
 * 创建可折叠的标签节点。
 *
 * @param element - 标签条目
 * @returns 带标签菜单上下文的树项
 */
function renderTag(element: TagEntry): vscode.TreeItem {
  const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
  item.iconPath = new vscode.ThemeIcon(TAG_ICON);
  item.contextValue = 'folders.tag';
  return item;
}

/**
 * 创建“未加标签”虚拟节点。该节点不设置菜单上下文，并通过资源 URI 应用弱化装饰。
 *
 * @returns “未加标签”树项
 */
function renderUntagged(): vscode.TreeItem {
  const item = new vscode.TreeItem(
    vscode.l10n.t('Untagged'),
    vscode.TreeItemCollapsibleState.Collapsed
  );
  item.resourceUri = UNTAGGED_RESOURCE;
  item.iconPath = new vscode.ThemeIcon(TAG_ICON);
  item.tooltip = vscode.l10n.t('Virtual group collecting items without any tag.');
  return item;
}

/**
 * 渲染文件系统节点。可访问目录支持展开，文件绑定打开命令；受管理节点的
 * `contextValue` 会包含类型、分组、标签和可访问状态，供菜单条件判断。
 *
 * @param element - 文件系统节点
 * @returns 对应的树项
 */
function renderNodeEntry(element: NodeEntry): vscode.TreeItem {
  const isDirectory = element.type === vscode.FileType.Directory;
  // 其他远程连接的目录不可展开，防止当前连接访问错误主机上的同名路径。
  const expandable = isDirectory && isFsAccessible(element.uri);
  const item = new vscode.TreeItem(
    element.uri,
    expandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
  );

  // 不可展开的目录需要显式指定图标，否则主题可能按文件 URI 显示文件图标。
  if (isDirectory && !expandable) {
    item.iconPath = new vscode.ThemeIcon('folder');
  }

  // 文件节点单击后在编辑器中预览。
  if (!isDirectory) {
    item.command = OPEN_FILE_COMMAND.treeItemCommand(
      vscode.l10n.t('Open File'),
      element.uri,
    );
  }

  // 只有登记条目需要菜单上下文；目录通过行内按钮打开，不绑定整行单击命令。
  if (element.managed) {
    const base = isDirectory ? 'folders.folder' : 'folders.file';
    // 后缀对应 package.json 中的菜单条件，顺序必须保持一致。
    const suffix = [
      element.group && '.grouped',
      element.tags?.length && '.tagged',
      isDirectory && !expandable && '.inaccessible',
    ]
      .filter(Boolean)
      .join('');
    item.contextValue = `${base}${suffix}`;
  }

  return item;
}

/** 与 {@link Entry} 各成员一一对应的渲染器表。 */
export const treeItemRenderers: Renderers = {
  placeholder: renderPlaceholder,
  missing: renderMissing,
  unavailable: renderUnavailable,
  configError: renderConfigError,
  invalidEntries: renderInvalidEntries,
  group: renderGroup,
  ungrouped: renderUngrouped,
  tag: renderTag,
  untagged: renderUntagged,
  node: renderNodeEntry,
};
