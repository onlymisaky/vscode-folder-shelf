import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { SETTING_CONFIG_FILE, SETTING_SECTION } from '../settings';
import { FolderStore } from './folderStore';
import { ViewModeStore } from './viewModeStore';
import { provide } from './container';

/** 用户主目录中的默认存储目录名。 */
const DEFAULT_DIR_NAME = '.folder-shelf';
/** 默认配置文件名。 */
const DEFAULT_FILE_NAME = 'config.json';

/**
 * 解析树配置文件的位置。自定义路径支持以 `~` 表示用户主目录；未配置时优先
 * 使用 `~/.folder-shelf/config.json`，无法创建该目录时改用扩展全局存储目录。
 *
 * @param context - 提供全局存储目录的扩展上下文
 * @returns 配置文件的绝对 URI；文件可能尚未创建
 */
async function resolveConfigFile(context: vscode.ExtensionContext): Promise<vscode.Uri> {
  const raw = vscode.workspace
    .getConfiguration(SETTING_SECTION)
    .get<string>(SETTING_CONFIG_FILE)
    ?.trim();
  if (!raw) {
    const homeDir = vscode.Uri.file(path.join(os.homedir(), DEFAULT_DIR_NAME));
    const globalFile = vscode.Uri.joinPath(context.globalStorageUri, DEFAULT_FILE_NAME);
    const homeFile = vscode.Uri.joinPath(homeDir, DEFAULT_FILE_NAME);

    // 先验证默认目录可写；创建失败时使用 VS Code 管理的全局存储目录。
    try {
      await vscode.workspace.fs.createDirectory(homeDir);
    } catch {
      return globalFile;
    }

    return homeFile;
  }

  // 只将路径开头的 `~` 或 `~/` 展开为用户主目录。
  const expanded = raw === '~' || raw.startsWith('~/')
    ? os.homedir() + raw.slice(1)
    : raw;
  return vscode.Uri.file(expanded);
}

/**
 * 创建并注册扩展服务，同时监听配置文件路径设置的变化。
 *
 * @param context - 提供全局状态和存储目录的扩展上下文
 * @returns 应加入 `context.subscriptions` 的服务和监听器
 */
export async function registerServices(context: vscode.ExtensionContext): Promise<vscode.Disposable[]> {
  const folderStore = new FolderStore(await resolveConfigFile(context));
  const viewModeStore = new ViewModeStore(context.globalState);

  // 路径解析期间设置可能再次变化，序号可防止较早的异步结果覆盖最新设置。
  let resolution = 0;
  const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration(`${SETTING_SECTION}.${SETTING_CONFIG_FILE}`)) {
      return;
    }
    // 仅应用最后一次设置变化对应的解析结果。
    const ticket = ++resolution;
    void resolveConfigFile(context).then((uri) => {
      if (ticket === resolution) {
        folderStore.setFile(uri);
      }
    });
  });

  provide(FolderStore, folderStore);
  provide(ViewModeStore, viewModeStore);
  return [folderStore, viewModeStore, configWatcher];
}
