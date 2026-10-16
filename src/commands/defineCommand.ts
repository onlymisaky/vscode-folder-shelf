
import * as vscode from 'vscode';
import { ConfigFileError } from '../services/configFileError';
import { reportConfigFileError } from '../utils';

/** 约束命令 ID 必须以 folderShelf. 开头 */
export type CommandId = `folderShelf.${string}`;

/**
 * @template Id - 命令 ID 字面量类型
 * @template Args - 命令回调的参数元组类型
 */
export interface CommandDefinition<Id extends CommandId, Args extends unknown[] = []> {
  /** 与 `package.json` 中命令贡献点对应的命令 ID。 */
  readonly id: Id;
  /** VS Code 触发命令时调用的执行函数，实参来自菜单回传或 treeItemCommand / useCommand 构造时传入 */
  readonly callback: (...args: Args) => void | Promise<void>;
  /**
   * 构造仅含命令 ID 的引用，供状态栏等纯文本场景使用。
   *
   * @returns 当前命令的完整 ID
   * @deprecated 保留给无法使用 treeItemCommand 的遗留场景
   */
  useCommand(): string;
  /**
   * 构造带标题、无实参的 VSCode 命令引用。
   *
   * @param title - 命令标题
   * @returns 可绑定到 VS Code UI 元素的命令对象
   * @deprecated 保留给无法使用 treeItemCommand 的遗留场景
   */
  useCommand(title: string): vscode.Command;
  /**
   * 构造带标题与参数的 VS Code 命令引用，触发时按原顺序传给回调。
   *
   * @param title - 命令标题
   * @param commandArgs - 与命令回调参数元组一致的实参
   * @returns 可绑定到 VS Code UI 元素的命令对象
   * @deprecated 保留给无法使用 treeItemCommand 的遗留场景
   */
  useCommand(title: string, ...commandArgs: Args): vscode.Command;
  /**
   * 构造树条目或行内按钮使用的 VS Code 命令引用。
   *
   * @param title - 命令标题
   * @param args - 与命令回调参数元组一致的实参
   * @returns 可绑定到树项的命令对象
   */
  treeItemCommand: (title: string, ...args: Args) => vscode.Command;
}

/**
 * 校验命令 ID 的前缀和分段格式，并将其类型收窄为 {@link CommandId}。
 *
 * @param id - 待校验的命令 ID；各段只能包含字母、数字和连字符
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
 * @param id - 以 `folderShelf.` 开头的命令 ID
 * @param callback - 同步或异步命令回调
 * @returns 命令定义及其 UI 引用构造方法
 */
export function defineCommand<Id extends CommandId, Args extends unknown[] = []>(
  id: Id,
  callback: (...args: Args) => void | Promise<void>
): CommandDefinition<Id, Args> {

  ensureCommandId(id);

  /**
   * 执行命令回调，将配置文件错误转换为用户提示，其他错误继续抛出。
   *
   * @param args - VS Code 传入的命令参数
   * @returns 表示命令执行和错误处理已完成的 Promise
   */
  async function run(...args: Args): Promise<void> {
    try {
      await callback(...args);
    } catch (error) {
      if (error instanceof ConfigFileError) {
        await reportConfigFileError(error);
        return;
      }
      throw error;
    }
  }

  /**
   * 获取命令 ID。
   *
   * @returns 当前命令的完整 ID
   */
  function useCommand(): string;
  /**
   * 构造不携带执行参数的命令对象。
   *
   * @param title - 命令标题
   * @returns 可绑定到 VS Code UI 元素的命令对象
   */
  function useCommand(title: string): vscode.Command;
  /**
   * 构造携带执行参数的命令对象。
   *
   * @param title - 命令标题
   * @param commandArgs - 与命令回调参数元组一致的实参
   * @returns 可绑定到 VS Code UI 元素的命令对象
   */
  function useCommand(title: string, ...commandArgs: Args): vscode.Command;
  /**
   * 根据是否提供标题，构造命令对象或返回命令 ID。
   *
   * @param title - 可选命令标题；省略时仅返回命令 ID
   * @param commandArgs - 与命令回调参数元组一致的实参
   * @returns 命令对象；省略标题时为命令 ID
   */
  function useCommand(title?: string, ...commandArgs: Args): vscode.Command | string {
    if (typeof title === 'undefined') return id;

    return {
      title,
      command: id,
      ...(commandArgs.length > 0 ? { arguments: commandArgs } : {}),
    }
  }

  return {
    id,
    callback: run,
    useCommand,
    treeItemCommand: (title: string, ...args: Args) => useCommand(title, ...args),
  };
}
