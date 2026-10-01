
import * as vscode from 'vscode';

export type CommandId = `folderShelf.${string}`;

export interface CommandDefinition<Id extends CommandId, Args extends unknown[] = []> {
  readonly id: Id;
  readonly callback: (...args: Args) => void | Promise<void>;
  /**  @deprecated */
  useCommand(): string;
  /**  @deprecated */
  useCommand(title: string): vscode.Command;
  /**  @deprecated */
  useCommand(title: string, ...commandArgs: Args): vscode.Command;
  treeItemCommand: (title: string, ...args: Args) => vscode.Command;
}

export function ensureCommandId(id: string): asserts id is CommandId {
  if (!/^folderShelf(\.[a-zA-Z0-9-]+)+$/.test(id)) {
    throw new Error(`invalid command id: ${id}`);
  }
}

export function defineCommand<Id extends CommandId, Args extends unknown[] = []>(
  id: Id,
  callback: (...args: Args) => void | Promise<void>
): CommandDefinition<Id, Args> {

  ensureCommandId(id);
  
  function useCommand(): string;
  function useCommand(title: string): vscode.Command;
  function useCommand(title: string, ...commandArgs: Args): vscode.Command;
  function useCommand(title?: string, ...commandArgs: Args): vscode.Command | string {
    // 状态栏命令
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
