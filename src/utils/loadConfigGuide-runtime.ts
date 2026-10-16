import * as vscode from 'vscode';

/**
 * @param guideBaseName - 默认指南文件名
 * @param extensionUri - 扩展安装目录的 URI
 * @returns 配置指南的 Markdown 文本
 */
export async function loadGuideFromFile(guideBaseName: string, extensionUri: vscode.Uri): Promise<string> {
  const decoder = new TextDecoder();
  /**
   * 读取并解码单个指南文件。
   *
   * @param fileName - `resources/docs` 下的文件名
   * @returns UTF-8 文档内容
   */
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
