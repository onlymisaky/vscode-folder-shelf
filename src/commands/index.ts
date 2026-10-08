import * as vscode from 'vscode';
import { OPEN_FILE_COMMAND, OPEN_FOLDERS_FILE_COMMAND } from './fileCommands';
import { ADD_CURRENT_PROJECT_COMMAND, ADD_FOLDER_COMMAND, COLLAPSE_ALL_COMMAND, OPEN_FOLDER_COMMAND, REMOVE_FOLDER_COMMAND } from './folderCommands';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerCommands(_deps: unknown): vscode.Disposable[] {
  const commands = [
    OPEN_FILE_COMMAND,
    OPEN_FOLDERS_FILE_COMMAND,
    ADD_FOLDER_COMMAND,
    ADD_CURRENT_PROJECT_COMMAND,
    OPEN_FOLDER_COMMAND,
    REMOVE_FOLDER_COMMAND,
    COLLAPSE_ALL_COMMAND,
    // REMOVE_FOLDER_COMMAND_WIRED.wire(deps),
  ];

  return commands.map((command) => {
    return vscode.commands.registerCommand(command.id, command.callback);
  });
}

export {
  OPEN_FILE_COMMAND,
  OPEN_FOLDERS_FILE_COMMAND,
  ADD_FOLDER_COMMAND,
  ADD_CURRENT_PROJECT_COMMAND,
  OPEN_FOLDER_COMMAND,
  REMOVE_FOLDER_COMMAND,
  COLLAPSE_ALL_COMMAND,
};
