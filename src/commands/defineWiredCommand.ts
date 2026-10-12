import * as vscode from 'vscode';
import { defineCommand, CommandDefinition, CommandId, ensureCommandId } from './defineCommand';

/**
 * 需要外部依赖的命令定义：仅声明 setup，由组合根调用 wire 注入依赖后才得到可注册的标准定义。
 *
 * @template Id - 命令 ID 字面量类型（约束在 CommandId 范围内）
 * @template Deps - 依赖集合的类型（如 { foldersView: vscode.TreeView<Entry> }）
 * @template Args - 命令回调的参数元组类型
 */
export interface WiredCommandDefinition<Id extends CommandId, Deps, Args extends unknown[] = []> {
  /** 命令唯一 ID（folderShelf. 前缀，与 package.json contributes.commands 对应） */
  readonly id: Id;
  /**
   * 注入命令运行所需依赖，并生成可注册的标准命令定义。
   *
   * @param deps - 与泛型 Deps 匹配的依赖集合，只能由组合根提供
   * @returns 已绑定执行回调的标准命令定义
   */
  wire(deps: Deps): CommandDefinition<Id, Args>;
  /**
   * 构造树条目单击或 inline 按钮使用的命令引用；该操作不依赖 wire。
   *
   * @param title - 命令标题；应使用已完成本地化的非空文本
   * @param args - 与命令回调参数元组 Args 一致的实参
   * @returns 可绑定到 TreeItem 的命令对象
   */
  treeItemCommand: (title: string, ...args: Args) => vscode.Command;
}

/**
 * 定义需要组合根显式注入依赖的命令。调用 wire 后才生成可注册的命令定义；
 * treeItemCommand 只构造命令引用，因此不依赖注入结果。
 *
 * @example
 * ```ts
 * const SHOW_SELECTION = defineWiredCommand(
 *   'folderShelf.showSelection',
 *   ({ foldersView }: { foldersView: vscode.TreeView<unknown> }) => () => {
 *     void foldersView.selection;
 *   }
 * );
 *
 * // 组合根创建 TreeView 后注入依赖，再注册生成的命令。
 * const command = SHOW_SELECTION.wire({ foldersView });
 * context.subscriptions.push(
 *   vscode.commands.registerCommand(command.id, command.callback)
 * );
 * ```
 *
 * @param id - 命令 ID（须符合 folderShelf.* 格式）
 * @param setup - 接收依赖集合，返回与命令签名一致的执行回调
 * @returns 带有 wire 方法的命令定义（wire 返回标准 {@link CommandDefinition}，treeItemCommand 构造树条目命令引用）
 */
export function defineWiredCommand<Id extends CommandId, Deps, Args extends unknown[] = []>(
  id: Id,
  setup: (deps: Deps) => (...args: Args) => void | Promise<void>
): WiredCommandDefinition<Id, Deps, Args> {

  ensureCommandId(id);

  return {
    id,
    wire: (deps) => defineCommand(id, setup(deps)),
    treeItemCommand: (title, ...args) => ({
      title,
      command: id,
      ...(args.length > 0 ? { arguments: args } : {}),
    }),
  };
}
