import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { FolderStore } from './folderStore';
import { provide } from './container';

const SECTION = 'folderShelf';
const SETTING_CONFIG_FILE = 'configFile';
const DEFAULT_DIR_NAME = '.folder-shelf';
const DEFAULT_FILE_NAME = 'config.json';

/** 解析收藏列表配置文件的实际位置：
 *  设置了 configFile 则用之（支持 ~ 指向主目录）；
 *  未设置时优先 ~/.folder-shelf/config.json，
 *  用户目录不可用再降级 globalStorage。
 */
async function resolveConfigFile(context: vscode.ExtensionContext): Promise<vscode.Uri> {
  const raw = vscode.workspace
    .getConfiguration(SECTION)
    .get<string>(SETTING_CONFIG_FILE)
    ?.trim();
  if (!raw) {
    const homeDir = vscode.Uri.file(path.join(os.homedir(), DEFAULT_DIR_NAME));
    const globalFile = vscode.Uri.joinPath(context.globalStorageUri, DEFAULT_FILE_NAME);
    const homeFile = vscode.Uri.joinPath(homeDir, DEFAULT_FILE_NAME);

    // 优先 ~/.folder-shelf/config.json（用户目录不可用时降级 globalStorage）
    try {
      await vscode.workspace.fs.createDirectory(homeDir);
    } catch {
      return globalFile; // 用户目录不可用，降级
    }

    return homeFile;
  }

  const expanded = raw === '~' || raw.startsWith('~/')
    ? os.homedir() + raw.slice(1)
    : raw;
  return vscode.Uri.file(expanded);
}

export async function registerServices(context: vscode.ExtensionContext): Promise<vscode.Disposable[]> {
  const folderStore = new FolderStore(await resolveConfigFile(context));

  // 解析为异步且探测期间设置可能再次变更：用递增 ticket 保证只有最新一次的解析结果生效
  let resolution = 0;
  const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration(`${SECTION}.${SETTING_CONFIG_FILE}`)) {
      return;
    }
    // 切换持久化文件（store 内部会重置缓存并触发视图刷新）
    const ticket = ++resolution;
    void resolveConfigFile(context).then((uri) => {
      if (ticket === resolution) {
        folderStore.setFile(uri);
      }
    });
  });

  provide(FolderStore, folderStore);
  return [folderStore, configWatcher];
}
