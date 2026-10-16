import * as vscode from 'vscode';
import { defineCommand, CommandDefinition, CommandId, ensureCommandId } from './defineCommand';

/**
 * 需要在组合入口注入依赖后才能注册的命令定义。
 *
 * @template Id - 命令 ID 字面量类型（约束在 CommandId 范围内）
 * @template Deps - 依赖集合的类型（如 { foldersView: vscode.TreeView<Entry> }）
 * @template Args - 命令回调的参数元组类型
 */
export interface WiredCommandDefinition<Id extends CommandId, Deps, Args extends unknown[] = []> {
  /** 与 `package.json` 中命令贡献点对应的命令 ID。 */
  readonly id: Id;
  /**
   * 注入命令运行所需依赖，并生成可注册的标准命令定义。
   *
   * @param deps - 命令运行所需的依赖
   * @returns 已绑定执行回调的命令定义
   */
  wire(deps: Deps): CommandDefinition<Id, Args>;
  /**
   * 构造树条目或行内按钮使用的命令引用；该操作无需先注入依赖。
   *
   * @param title - 非空命令标题
   * @param args - 与命令回调参数元组一致的实参
   * @returns 可绑定到树项的命令对象
   */
  treeItemCommand: (title: string, ...args: Args) => vscode.Command;
}

/**
 * 定义需要显式注入依赖的命令。调用 `wire` 后生成可注册的命令定义；
 * `treeItemCommand` 仅创建命令引用，不依赖注入结果。
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
 * // 创建 TreeView 后注入依赖，再注册生成的命令。
 * const command = SHOW_SELECTION.wire({ foldersView });
 * context.subscriptions.push(
 *   vscode.commands.registerCommand(command.id, command.callback)
 * );
 * ```
 *
 * @param id - 以 `folderShelf.` 开头的命令 ID
 * @param setup - 根据依赖创建命令回调的函数
 * @returns 可注入依赖的命令定义
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
