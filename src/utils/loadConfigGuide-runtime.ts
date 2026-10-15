import * as vscode from 'vscode';

/**
 * 运行时经 workspace.fs 读取扩展包内 resources/docs 下的指南文档。
 * 按 vscode.l10n.language 匹配 `config-guide.<lang>.md`，文件缺失时回退默认文档。
 *
 * @param guideBaseName 指南文档在扩展包内的目录与默认文件名
 * @param extensionUri 扩展安装根目录
 * @returns 指南 Markdown 文本
 */
export async function loadGuideFromFile(guideBaseName: string, extensionUri: vscode.Uri): Promise<string> {
  const decoder = new TextDecoder();
  const read = async (fileName: string): Promise<string> =>
    decoder.decode(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, 'resources', 'docs', fileName))
    );

  const lang = vscode.env.language.toLowerCase();
  if (lang) {
    try {
      return await read(guideBaseName.replace(/\.md$/, `.${lang}.md`));
    } catch {
      // 无对应语言文件，回退默认文档
    }
  }
  return read(guideBaseName);
}