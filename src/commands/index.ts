import * as vscode from 'vscode';
import { OPEN_FILE_COMMAND, OPEN_CONFIG_FILE_COMMAND } from './fileCommands';
import { ADD_CURRENT_PROJECT_COMMAND, ADD_ITEM_COMMAND, COLLAPSE_ALL_COMMAND, OPEN_FOLDER_COMMAND, REFRESH_COMMAND, REMOVE_ITEM_COMMAND } from './folderCommands';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerCommands(_deps: unknown): vscode.Disposable[] {
  const commands = [
    OPEN_FILE_COMMAND,
    OPEN_CONFIG_FILE_COMMAND,
    ADD_ITEM_COMMAND,
    ADD_CURRENT_PROJECT_COMMAND,
    OPEN_FOLDER_COMMAND,
    REMOVE_ITEM_COMMAND,
    COLLAPSE_ALL_COMMAND,
    REFRESH_COMMAND,
    // REMOVE_ITEM_COMMAND_WIRED.wire(deps),
  ];

  return commands.map((command) => {
    return vscode.commands.registerCommand(command.id, command.callback);
  });
}

export {
  OPEN_FILE_COMMAND,
  OPEN_CONFIG_FILE_COMMAND,
  ADD_ITEM_COMMAND,
  ADD_CURRENT_PROJECT_COMMAND,
  OPEN_FOLDER_COMMAND,
  REMOVE_ITEM_COMMAND,
  COLLAPSE_ALL_COMMAND,
  REFRESH_COMMAND,
};
