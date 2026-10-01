import * as vscode from 'vscode';
import { OPEN_FILE_COMMAND, OPEN_FOLDERS_FILE_COMMAND } from './fileCommands';
import { ADD_FOLDER_COMMAND, REMOVE_FOLDER_COMMAND_WIRED } from './folderCommands';
import type { AddFolderCommandDeps } from './folderCommands';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CommandDeps extends AddFolderCommandDeps {

}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const commands = [
    OPEN_FILE_COMMAND,
    OPEN_FOLDERS_FILE_COMMAND,
    ADD_FOLDER_COMMAND,
    REMOVE_FOLDER_COMMAND_WIRED.wire(deps),
  ];

  return commands.map((command) => {
    return vscode.commands.registerCommand(command.id, command.callback);
  });
}

export {
  OPEN_FILE_COMMAND,
  OPEN_FOLDERS_FILE_COMMAND,
  ADD_FOLDER_COMMAND,
  REMOVE_FOLDER_COMMAND_WIRED
};
