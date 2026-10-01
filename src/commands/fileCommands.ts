import * as vscode from 'vscode';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';

export const OPEN_FILE_COMMAND = defineCommand('folderShelf.openFile', async (uri: vscode.Uri) => {
  // 只有工作区文件才能以预览模式打开，否则会报错
  // vscode.window.showTextDocument(uri, { preview: true });
  await vscode.commands.executeCommand('vscode.open', uri, { preview: true })
})

/** 打开当前 folders.json（配置的自定义路径或 globalStorage 默认路径），不存在时先创建空骨架。 */
export const OPEN_FOLDERS_FILE_COMMAND = defineCommand(
  'folderShelf.openFoldersFile',
  async (): Promise<void> => {
    const folderStore = inject(FolderStore);
    await folderStore.ensureFile();
    await vscode.commands.executeCommand('vscode.open', folderStore.file, { preview: true });
  }
);
