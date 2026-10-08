import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { FolderStore } from './folderStore';
import { provide } from './container';

const SECTION = 'folderShelf';
const SETTING_FOLDERS_FILE = 'foldersFile';
const DEFAULT_DIR_NAME = '.folder-shelf';

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** 解析 folders.json 的实际位置：
 *  设置了 foldersFile 则用之（支持 ~ 指向主目录）；
 *  未设置时优先 ~/.folder-shelf/folders.json，
 *  用户目录不可用再降级 globalStorage。 
 */
async function resolveFoldersFile(context: vscode.ExtensionContext): Promise<vscode.Uri> {
  const raw = vscode.workspace
    .getConfiguration(SECTION)
    .get<string>(SETTING_FOLDERS_FILE)
    ?.trim();
  if (!raw) {
    const globalFile = vscode.Uri.joinPath(context.globalStorageUri, 'folders.json');
    const homeDir = vscode.Uri.file(path.join(os.homedir(), DEFAULT_DIR_NAME));
    const homeFile = vscode.Uri.joinPath(homeDir, 'folders.json');

    // 优先 ~/.folder-shelf/folders.json（用户目录不可用时降级 globalStorage）
    try {
      await vscode.workspace.fs.createDirectory(homeDir);
    } catch {
      return globalFile; // 用户目录不可用，降级
    }

    // home 侧尚无文件而 globalStorage 有旧数据时，自动迁移一份过来。
    try {
      if (!(await fileExists(homeFile)) && (await fileExists(globalFile))) {
        await vscode.workspace.fs.copy(globalFile, homeFile, { overwrite: false });
      }
    } catch {
      // 迁移失败不阻塞使用，继续用用户目录
    }

    return homeFile;
  }

  const expanded = raw === '~' || raw.startsWith('~/')
    ? os.homedir() + raw.slice(1)
    : raw;
  return vscode.Uri.file(expanded);
}

export async function registerServices(context: vscode.ExtensionContext): Promise<vscode.Disposable[]> {
  const folderStore = new FolderStore(await resolveFoldersFile(context));

  // 解析为异步且探测期间设置可能再次变更：用递增 ticket 保证只有最新一次的解析结果生效
  let resolution = 0;
  const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration(`${SECTION}.${SETTING_FOLDERS_FILE}`)) {
      return;
    }
    // 切换持久化文件（store 内部会重置缓存并触发视图刷新）
    const ticket = ++resolution;
    void resolveFoldersFile(context).then((uri) => {
      if (ticket === resolution) {
        folderStore.setFile(uri);
      }
    });
  });

  provide(FolderStore, folderStore);
  return [folderStore, configWatcher];
}
