import * as vscode from 'vscode';

/**
 * config.json 的 path 字段协议支持：统一「path 字符串 ↔ 资源 Uri」的转换出口。
 *
 * 采用协议白名单而非通用 scheme 探测——Windows 盘符路径（如 `C:\foo`）的 `C:`
 * 会被误判为 scheme，白名单可规避误判；扩展支持范围时只需补充本表。
 */

/** 虚拟/远程资源协议：写侧存完整 URI 串，能力分支（终端/Finder 等选项裁剪）以此为界 */
export const VIRTUAL_URI_SCHEMES: readonly string[] = ['vscode-remote', 'vscode-vfs'];

/** 读侧可识别的 URI 协议：path 带这些前缀（形如 scheme://…）时按 URI 解析，否则视为本地纯路径 */
const KNOWN_URI_SCHEMES: readonly string[] = ['file', ...VIRTUAL_URI_SCHEMES];

/**
 * 判断 scheme 是否为虚拟协议。
 *
 * @param scheme - 待判断的 Uri scheme
 * @returns 在白名单内时为 true
 */
export function hasVirtualScheme(scheme: string): boolean {
  return VIRTUAL_URI_SCHEMES.includes(scheme);
}

export function isSupportedScheme(scheme: string): boolean {
  return KNOWN_URI_SCHEMES.includes(scheme)
}

/**
 * config.json 的 path 字段 → 资源 Uri。
 * 带可识别协议前缀的（`file://`、`vscode-remote://` 等）经 Uri.parse 解析——
 * `file` 的纳入让手写 `file:///...` 与纯路径两种书写归一到相同匹配键；
 * 其余一律按本地文件路径处理（与既有纯路径数据兼容）。
 *
 * @param p - 条目 path 字段（纯本地路径或可识别协议的完整 URI）
 * @returns 对应的资源 Uri
 */
export function itemUriOf(p: string): vscode.Uri {
  const matched = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(p);
  if (matched?.[1] && KNOWN_URI_SCHEMES.includes(matched[1].toLowerCase())) {
    return vscode.Uri.parse(p);
  }
  return vscode.Uri.file(p);
}

/**
 * 资源 Uri → config.json 的 path 字段。
 * 虚拟协议存完整 URI（`uri.toString()` 规范化形态，round-trip 稳定）；
 * file 协议存纯本地路径（`fsPath`，与既有数据格式兼容，零迁移）。
 *
 * @param uri - 资源 Uri
 * @returns 写入 config.json 的 path 字段值
 */
export function itemPathOf(uri: vscode.Uri): string {
  return hasVirtualScheme(uri.scheme) ? uri.toString() : uri.fsPath;
}


/**
 * 获取 Uri 的工作目录。
 * file 协议返回纯路径；虚拟协议返回 Uri 本身。
 *
 * @param uri - 资源 Uri
 * @returns 工作目录 Uri
 */
export function getUriCwd(uri: vscode.Uri): vscode.Uri {
  return uri.scheme === 'file' ? vscode.Uri.file(uri.fsPath) : uri;
}

/**
 * 获取当前窗口的远程连接 authority。
 * 远程窗口中，工作区根目录（vscode-remote 协议）的 authority 即当前连接；
 * 本地窗口无远程根目录，返回 undefined。
 *
 * 注：无根目录的远程窗口取不到 authority，属极端场景，远程条目统一按不可访问处理。
 */
export function currentRemoteAuthority(): string | undefined {
  return (vscode.workspace.workspaceFolders ?? []).find(
    (folder) => folder.uri.scheme === 'vscode-remote'
  )?.uri.authority;
}

/**
 * 判断资源是否可在当前窗口安全发起 workspace.fs 调用。
 * vscode-remote 协议仅当 authority 与当前窗口连接一致时安全：远程文件系统提供程序按
 * scheme 注册并绑定当前连接，转发链路（客户端 channel 透传 + 服务端 transformIncoming）
 * 均不校验 authority，跨 authority 的请求会被当前连接的主机按 path 读取——
 * 读到错误机器的同名路径，或误报 FileNotFound。
 * 其余协议（file / vscode-vfs 等）无此问题，一律放行（vfs 提供程序未激活的 ENOPRO
 * 由调用方按「不可访问」处理）。
 *
 * @param uri - 待判断的资源 Uri
 * @returns 可安全发起 fs 调用时为 true
 */
export function isFsAccessible(uri: vscode.Uri): boolean {
  if (uri.scheme !== 'vscode-remote') {
    return true;
  }
  return currentRemoteAuthority() === uri.authority;
}