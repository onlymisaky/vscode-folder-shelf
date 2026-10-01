import * as vscode from 'vscode';
import * as os from 'node:os';
import { FolderStore } from './folderStore';
import { provide } from './container';

const SECTION = 'folderShelf';
const SETTING_FOLDERS_FILE = 'foldersFile';

/** 解析 folders.json 的实际位置：设置了 foldersFile 则用之（支持 ~ 指向主目录），否则回退 globalStorage。 */
function resolveFoldersFile(context: vscode.ExtensionContext): vscode.Uri {
  const raw = vscode.workspace
    .getConfiguration(SECTION)
    .get<string>(SETTING_FOLDERS_FILE)
    ?.trim();
  if (!raw) {
    return vscode.Uri.joinPath(context.globalStorageUri, 'folders.json');
  }
  const expanded = raw === '~' || raw.startsWith('~/')
    ? os.homedir() + raw.slice(1)
    : raw;
  return vscode.Uri.file(expanded);
}

export function registerServices(context: vscode.ExtensionContext): vscode.Disposable[] {
  const folderStore = new FolderStore(resolveFoldersFile(context));

  // 设置变更时切换持久化文件（store 内部会重置缓存并触发视图刷新）
  const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${SECTION}.${SETTING_FOLDERS_FILE}`)) {
      folderStore.setFile(resolveFoldersFile(context));
    }
  });

  provide(FolderStore, folderStore);
  return [folderStore, configWatcher];
}
