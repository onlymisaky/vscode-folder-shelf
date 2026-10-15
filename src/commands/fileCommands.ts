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
 *
 * @param position - 可选的错误定位（1 基行列，来自错误弹窗）；提供时光标直接落在该位置。
 *                   报错后文件可能已被编辑，行列按文档实际行数与行宽钳制，避免选区越界。
 */
export const OPEN_CONFIG_FILE_COMMAND = defineCommand(
  'folderShelf.openConfigFile',
  async (position?: { line?: number; column?: number }): Promise<void> => {
    const folderStore = inject(FolderStore);
    await folderStore.ensureFile();

    const options: vscode.TextDocumentShowOptions = { preview: true };
    if (typeof position?.line === 'number' && typeof position.column === 'number') {
      const doc = await vscode.workspace.openTextDocument(folderStore.file);
      const line = Math.min(Math.max(position.line - 1, 0), Math.max(doc.lineCount - 1, 0));
      const column = Math.min(Math.max(position.column - 1, 0), doc.lineAt(line).text.length);
      options.selection = new vscode.Range(line, column, line, column);
    }

    await vscode.commands.executeCommand('vscode.open', folderStore.file, options);
  }
);
