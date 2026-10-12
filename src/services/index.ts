import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { FolderStore } from './folderStore';
import { ViewModeStore } from './viewModeStore';
import { provide } from './container';

/** 设置段（package.json contributes.configuration 的前缀） */
const SECTION = 'folderShelf';
/** 配置项键名：收藏列表持久化文件的自定义路径（空串 = 使用默认位置） */
const SETTING_CONFIG_FILE = 'configFile';
/** 默认持久化目录名：用户主目录下的隐藏目录 */
const DEFAULT_DIR_NAME = '.folder-shelf';
/** 默认持久化文件名 */
const DEFAULT_FILE_NAME = 'config.json';

/**
 * 解析收藏列表配置文件的实际位置：
 * 设置了 configFile 则用之（支持 ~ 指向主目录）；
 * 未设置时优先 ~/.folder-shelf/config.json，
 * 用户目录不可用再降级 globalStorage。
 *
 * @param context - 扩展上下文（提供 globalStorage 目录）
 * @returns 配置文件的绝对 Uri（文件此刻可能尚不存在，由 FolderStore 读侧兜底为空列表）
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

  // 展开 ~ 为用户主目录（仅支持前缀形态：~ 与 ~/...）
  const expanded = raw === '~' || raw.startsWith('~/')
    ? os.homedir() + raw.slice(1)
    : raw;
  return vscode.Uri.file(expanded);
}

/**
 * 组合根：实例化全部服务并注册进容器，同时挂接 configFile 设置变更监听。
 *
 * @param context - 扩展上下文（提供 globalStorage 与设置读取）
 * @returns 需纳入 context.subscriptions 的可释放对象列表（两个服务实例 + 设置监听器）
 */
export async function registerServices(context: vscode.ExtensionContext): Promise<vscode.Disposable[]> {
  const folderStore = new FolderStore(await resolveConfigFile(context));
  const viewModeStore = new ViewModeStore(context.globalState);

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
  provide(ViewModeStore, viewModeStore);
  return [folderStore, viewModeStore, configWatcher];
}
