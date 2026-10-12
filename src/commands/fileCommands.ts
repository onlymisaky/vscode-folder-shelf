import * as vscode from 'vscode';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';

/**
 * 用编辑器打开指定文件（树中文件条目单击触发）。
 * 经 vscode.open 以预览模式打开（工作区外的文件亦可打开）。
 *
 * @param uri - 要打开的文件 Uri
 */
export const OPEN_FILE_COMMAND = defineCommand('folderShelf.openFile', async (uri: vscode.Uri) => {
  // 只有工作区文件才能以预览模式打开，否则会报错
  // vscode.window.showTextDocument(uri, { preview: true });
  await vscode.commands.executeCommand('vscode.open', uri, { preview: true });
});

/**
 * 打开 config.json 文件；文件不存在时先用当前缓存或空列表创建。
 */
export const OPEN_CONFIG_FILE_COMMAND = defineCommand(
  'folderShelf.openConfigFile',
  async (): Promise<void> => {
    const folderStore = inject(FolderStore);
    await folderStore.ensureFile();
    await vscode.commands.executeCommand('vscode.open', folderStore.file, { preview: true });
  }
);
