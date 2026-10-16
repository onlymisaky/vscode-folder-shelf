import * as vscode from 'vscode';
import { getConfigGuideContent } from './loadConfigGuide';

/** 配置指南虚拟文档使用的 URI 协议。 */
const CONFIG_GUIDE_SCHEME = 'folder-shelf-guide';

/** 扩展包内配置指南的默认文件名。 */
const GUIDE_BASE_NAME = 'config-guide.md';

/** 配置指南虚拟文档的固定 URI。 */
const CONFIG_GUIDE_URI = vscode.Uri.from({ scheme: CONFIG_GUIDE_SCHEME, path: GUIDE_BASE_NAME });

/**
 * 配置指南的虚拟文档内容提供器
 */
class ConfigGuideProvider implements vscode.TextDocumentContentProvider {
  private fileContent?: Promise<string>;

  /**
   * @param extensionUri - 扩展安装目录的 URI
   */
  constructor(private readonly extensionUri: vscode.Uri) { }

  /**
   * 读取并缓存配置指南内容。
   *
   * @returns 指南 Markdown 文本或其异步结果
   */
  provideTextDocumentContent(): string | Thenable<string> {
    this.fileContent ??= getConfigGuideContent(GUIDE_BASE_NAME, this.extensionUri);
    return this.fileContent;

    // return getConfigGuideContent();
  }
}

/**
 * 注册配置指南的虚拟文档提供器。
 *
 * @param extensionUri - 扩展安装目录的 URI
 * @returns 应加入 `context.subscriptions` 的注册句柄
 */
export function registerConfigGuide(extensionUri: vscode.Uri): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(CONFIG_GUIDE_SCHEME, new ConfigGuideProvider(extensionUri));
}

/**
 * 打开配置指南：优先以 Markdown 预览渲染展示，预览不可用时降级为纯文本编辑器。
 *
 * @returns 表示指南已打开的 Promise
 */
export async function openConfigGuide(): Promise<void> {
  try {
    await vscode.commands.executeCommand('markdown.showPreview', CONFIG_GUIDE_URI, { locked: true });
  } catch {
    const doc = await vscode.workspace.openTextDocument(CONFIG_GUIDE_URI);
    await vscode.window.showTextDocument(doc, { preview: true });
  }
}
