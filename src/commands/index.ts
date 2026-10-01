import * as vscode from 'vscode';
import { OPEN_FILE_COMMAND, OPEN_FOLDERS_FILE_COMMAND } from './fileCommands';
import { ADD_FOLDER_COMMAND, OPEN_FOLDER_COMMAND_WIRED, REMOVE_FOLDER_COMMAND_WIRED } from './folderCommands';
import type { FolderCommandDeps } from './folderCommands';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CommandDeps extends FolderCommandDeps {

}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const commands = [
    OPEN_FILE_COMMAND,
    OPEN_FOLDERS_FILE_COMMAND,
    ADD_FOLDER_COMMAND,
    OPEN_FOLDER_COMMAND_WIRED.wire(deps),
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
  OPEN_FOLDER_COMMAND_WIRED,
  REMOVE_FOLDER_COMMAND_WIRED
};
