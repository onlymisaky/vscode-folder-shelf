import * as vscode from 'vscode';
import { defineCommand, CommandDefinition } from './defineCommand';

export interface WiredCommandDefinition<Id extends string, Deps, Args extends unknown[] = []> {
  readonly id: Id;
  /** 组合根传入依赖，返回 callback 已绑定的标准 CommandDefinition */
  wire(deps: Deps): CommandDefinition<Id, Args>;
  treeItemCommand: (title: string, ...args: Args) => vscode.Command;
}

/**
 * wire 版本
 * 适合需要依赖，但是依赖不来自 service
 */
export function defineWiredCommand<Id extends string, Deps, Args extends unknown[] = []>(
  id: Id,
  setup: (deps: Deps) => (...args: Args) => void | Promise<void>
): WiredCommandDefinition<Id, Deps, Args> {
  if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z0-9-]+$/.test(id)) {
    throw new Error(`invalid command id: ${id}`);
  }

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