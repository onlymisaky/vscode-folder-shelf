import * as vscode from 'vscode';
import { defineCommand, CommandDefinition, CommandId, ensureCommandId } from './defineCommand';

export interface WiredCommandDefinition<Id extends CommandId, Deps, Args extends unknown[] = []> {
  readonly id: Id;
  /** 组合根传入依赖，返回 callback 已绑定的标准 CommandDefinition */
  wire(deps: Deps): CommandDefinition<Id, Args>;
  treeItemCommand: (title: string, ...args: Args) => vscode.Command;
}

/**
 * wire 版本
 * 适合需要依赖，但是依赖不来自 service
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