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
 * @example
 * ```ts
  const REMOVE_FOLDER_COMMAND_WIRED = defineWiredCommand(
    'folderShelf.removeFolder',
    (deps: { foldersView: vscode.TreeView<Entry> }) => {
      const { foldersView } = deps;
      return async function (): Promise<void> {
        const folderStore = inject(FolderStore);

        const targets = foldersView.selection
          .filter((entry): entry is NodeEntry => entry.kind === 'node' && entry.managed === true)
          .map((entry) => entry.uri);
        if (targets.length === 0) {
          return;
        }

        const REMOVE: vscode.MessageItem = { title: vscode.l10n.t('Remove') };
        const names = targets.map((uri) => path.basename(uri.fsPath));
        const message =
          names.length === 1 && names[0] !== undefined
            ? vscode.l10n.t(
              'Remove "{0}" from the list? Files on disk will not be affected.',
              names[0]
            )
            : vscode.l10n.t(
              'Remove {0} folders ({1}) from the list? Files on disk will not be affected.',
              names.length,
              names.join(', ')
            );
        const confirmed = await vscode.window.showWarningMessage(message, { modal: true }, REMOVE);
        if (confirmed !== REMOVE) {
          return;
        }

        await folderStore.remove(targets);
      };
    }
  );

  REMOVE_FOLDER_COMMAND_WIRED.wire({ foldersView });
 * ```
 * @param id 命令 ID
 * @param setup 组合根传入依赖，返回 callback 已绑定的标准 CommandDefinition
 * @returns 带有 wire 方法的 CommandDefinition
 * @returns treeItemCommand 命令在 tree item 中的表示
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