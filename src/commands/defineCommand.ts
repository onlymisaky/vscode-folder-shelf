
import * as vscode from 'vscode';

/** 本扩展命令 ID 的字面量模板类型：约束 ID 必须以 folderShelf. 为前缀 */
export type CommandId = `folderShelf.${string}`;

/**
 * 命令定义：VSCode 注册用的回调 + 供 UI 各处以强类型构造 vscode.Command 的工具方法。
 *
 * @template Id - 命令 ID 字面量类型（约束在 CommandId 范围内）
 * @template Args - 命令回调的参数元组类型（treeItemCommand / useCommand 的传参由此约束）
 */
export interface CommandDefinition<Id extends CommandId, Args extends unknown[] = []> {
  /** 命令唯一 ID（folderShelf. 前缀，与 package.json contributes.commands 对应） */
  readonly id: Id;
  /** 命令执行回调：触发时由 VSCode 调用，实参来自菜单回传或 treeItemCommand / useCommand 构造时传入 */
  readonly callback: (...args: Args) => void | Promise<void>;
  /**
   * 构造仅含命令 ID 的引用，供状态栏等纯文本场景使用。
   *
   * @returns 当前命令的完整 ID 字符串
   * @deprecated 保留给无法使用 treeItemCommand 的遗留场景
   */
  useCommand(): string;
  /**
   * 构造带标题、无实参的 VSCode 命令引用。
   *
   * @param title - 命令标题；应使用已完成本地化的非空文本
   * @returns 可直接绑定到 VSCode UI 元素的命令对象
   * @deprecated 保留给无法使用 treeItemCommand 的遗留场景
   */
  useCommand(title: string): vscode.Command;
  /**
   * 构造带标题与实参的 VSCode 命令引用，触发时实参按原顺序透传给回调。
   *
   * @param title - 命令标题；应使用已完成本地化的非空文本
   * @param commandArgs - 与命令回调参数元组 Args 一致的实参
   * @returns 可直接绑定到 VSCode UI 元素的命令对象
   * @deprecated 保留给无法使用 treeItemCommand 的遗留场景
   */
  useCommand(title: string, ...commandArgs: Args): vscode.Command;
  /**
   * 构造树条目单击或 inline 按钮使用的 VSCode 命令引用。
   *
   * @param title - 命令标题；应使用已完成本地化的非空文本
   * @param args - 与命令回调参数元组 Args 一致的实参
   * @returns 可绑定到 TreeItem 的命令对象
   */
  treeItemCommand: (title: string, ...args: Args) => vscode.Command;
}

/**
 * 校验命令 ID 形如 folderShelf.<seg>[.<seg>…]（段为字母/数字/连字符），并把类型收窄为 {@link CommandId}。
 *
 * @param id - 待校验的命令 ID
 * @throws 格式不符时抛出，使错误在构造命令定义时暴露，而不是等到命令执行时才出现
 */
export function ensureCommandId(id: string): asserts id is CommandId {
  if (!/^folderShelf(\.[a-zA-Z0-9-]+)+$/.test(id)) {
    throw new Error(`invalid command id: ${id}`);
  }
}

/**
 * 定义扩展命令：校验 ID 格式后包装为强类型的 {@link CommandDefinition}。
 *
 * @template Id - 命令 ID 字面量类型
 * @template Args - 命令回调参数元组类型
 * @param id - 命令唯一 ID（folderShelf. 前缀）
 * @param callback - 命令执行回调（可为异步）
 * @returns 完整命令定义（含 useCommand / treeItemCommand 命令引用构造工具）
 */
export function defineCommand<Id extends CommandId, Args extends unknown[] = []>(
  id: Id,
  callback: (...args: Args) => void | Promise<void>
): CommandDefinition<Id, Args> {

  ensureCommandId(id);

  /**
   * 获取命令 ID。
   *
   * @returns 当前命令的完整 ID 字符串
   */
  function useCommand(): string;
  /**
   * 构造不携带执行参数的命令对象。
   *
   * @param title - 命令标题；应使用已完成本地化的非空文本
   * @returns 可绑定到 VSCode UI 元素的命令对象
   */
  function useCommand(title: string): vscode.Command;
  /**
   * 构造携带执行参数的命令对象。
   *
   * @param title - 命令标题；应使用已完成本地化的非空文本
   * @param commandArgs - 与命令回调参数元组 Args 一致的实参
   * @returns 可绑定到 VSCode UI 元素的命令对象
   */
  function useCommand(title: string, ...commandArgs: Args): vscode.Command;
  /**
   * 根据是否提供标题，构造命令对象或返回命令 ID。
   *
   * @param title - 可选命令标题；省略时仅返回命令 ID
   * @param commandArgs - 与回调参数元组 Args 一致的命令实参
   * @returns 省略标题时为命令 ID，否则为可绑定到 UI 的命令对象
   */
  function useCommand(title?: string, ...commandArgs: Args): vscode.Command | string {
    // 状态栏命令：不传标题时仅返回命令 ID 字符串
    if (typeof title === 'undefined') return id;

    return {
      title,
      command: id,
      ...(commandArgs.length > 0 ? { arguments: commandArgs } : {}),
    }
  }

  return {
    id,
    callback,
    useCommand,
    treeItemCommand: (title: string, ...args: Args) => useCommand(title, ...args),
  };
}
