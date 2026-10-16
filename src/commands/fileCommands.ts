import * as vscode from 'vscode';
import { defineCommand } from './defineCommand';
import { FolderStore } from '../services/folderStore';
import { inject } from '../services/container';

/**
 * 在编辑器预览标签中打开文件，包括工作区之外的文件。
 *
 * @param uri - 要打开的文件 URI
 * @returns 表示打开命令已执行的 Promise
 */
export const OPEN_FILE_COMMAND = defineCommand('folderShelf.openFile', async (uri: vscode.Uri) => {
  await vscode.commands.executeCommand('vscode.open', uri, { preview: true });
});

/**
 * 打开配置文件；文件不存在时先用当前缓存或空列表创建。
 *
 * @param position - 可选的错误位置，行列从 1 开始；
 * 超出当前文档范围的值会限制到最近的有效位置
 * @returns 表示配置文件已创建并打开的 Promise
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
