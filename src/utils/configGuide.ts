import * as vscode from 'vscode';
import { getConfigGuideContent } from './loadConfigGuide';

/** 指南虚拟文档的 Uri scheme（经 TextDocumentContentProvider 提供内容） */
const CONFIG_GUIDE_SCHEME = 'folder-shelf-guide';

/** 指南文档在扩展包内的目录与默认文件名 */
const GUIDE_BASE_NAME = 'config-guide.md';

/** 指南虚拟文档的 Uri */
const CONFIG_GUIDE_URI = vscode.Uri.from({ scheme: CONFIG_GUIDE_SCHEME, path: GUIDE_BASE_NAME });

/**
 * 指南虚拟文档内容提供器
 */
class ConfigGuideProvider implements vscode.TextDocumentContentProvider {
  private fileContent?: Promise<string>;

  constructor(private readonly extensionUri: vscode.Uri) { }

  provideTextDocumentContent(): string | Thenable<string> {
    this.fileContent ??= getConfigGuideContent(GUIDE_BASE_NAME, this.extensionUri);
    return this.fileContent;

    // return getConfigGuideContent();
  }
}

/**
 * 注册指南虚拟文档提供器（激活期调用一次，Disposable 挂到 context.subscriptions）。
 *
 * @param extensionUri 扩展根目录（'runtime' 来源时用于定位包内文档）
 * @returns 可释放的注册句柄
 */
export function registerConfigGuide(extensionUri: vscode.Uri): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(CONFIG_GUIDE_SCHEME, new ConfigGuideProvider(extensionUri));
}

/**
 * 打开配置指南：优先以 Markdown 预览渲染展示，预览不可用时降级为纯文本编辑器。
 */
export async function openConfigGuide(): Promise<void> {
  try {
    await vscode.commands.executeCommand('markdown.showPreview', CONFIG_GUIDE_URI, { locked: true });
  } catch {
    const doc = await vscode.workspace.openTextDocument(CONFIG_GUIDE_URI);
    await vscode.window.showTextDocument(doc, { preview: true });
  }
}
