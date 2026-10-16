import * as vscode from 'vscode';

const VIRTUAL_URI_SCHEMES: readonly string[] = ['vscode-remote', 'vscode-vfs'];

const KNOWN_URI_SCHEMES: readonly string[] = ['file', ...VIRTUAL_URI_SCHEMES];

/**
 * 判断 URI 协议是否属于受支持的远程或虚拟文件系统。
 *
 * @param scheme - 待判断的 URI 协议
 * @returns 协议位于虚拟协议白名单时为 `true`
 */
function isVirtualScheme(scheme: string): boolean {
  return VIRTUAL_URI_SCHEMES.includes(scheme);
}

/**
 * 判断 URI 协议是否可保存为树条目。
 *
 * @param scheme - 待判断的 URI 协议
 * @returns 协议为本地、远程或虚拟文件系统协议时为 `true`
 */
export function isSupportedScheme(scheme: string): boolean {
  return KNOWN_URI_SCHEMES.includes(scheme);
}

/**
 * 将配置中的路径转换为资源 URI。带白名单协议的完整 URI 使用 `Uri.parse`，
 * 其他值按本地文件路径处理。
 *
 * @param p - 本地路径或带受支持协议的完整 URI
 * @returns 对应的资源 URI
 */
export function itemUriOf(p: string): vscode.Uri {
  const matched = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(p);
  if (matched?.[1] && KNOWN_URI_SCHEMES.includes(matched[1].toLowerCase())) {
    return vscode.Uri.parse(p);
  }
  return vscode.Uri.file(p);
}

/**
 * 将资源 URI 转换为配置中的路径。虚拟资源保存完整 URI，本地资源保存 `fsPath`，
 * 以兼容已有配置。
 *
 * @param uri - 资源 URI
 * @returns 可写入配置 `path` 字段的字符串
 */
export function itemPathOf(uri: vscode.Uri): string {
  return isVirtualScheme(uri.scheme) ? uri.toString() : uri.fsPath;
}
/**
 * 获取适合传给终端 `cwd` 的 URI。本地 URI 根据 `fsPath` 重建，虚拟 URI 保持不变。
 *
 * @param uri - 目录资源 URI
 * @returns 可用作终端工作目录的 URI
 */
export function getUriCwd(uri: vscode.Uri): vscode.Uri {
  return uri.scheme === 'file' ? vscode.Uri.file(uri.fsPath) : uri;
}

/**
 * 从工作区根目录获取当前窗口的远程连接 authority。无远程工作区根目录时无法
 * 可靠判断连接，返回 `undefined`。
 *
 * @returns 当前远程连接 authority；本地或无根目录窗口为 `undefined`
 */
export function currentRemoteAuthority(): string | undefined {
  return (vscode.workspace.workspaceFolders ?? []).find(
    (folder) => folder.uri.scheme === 'vscode-remote'
  )?.uri.authority;
}

/**
 * 判断当前窗口能否安全访问资源。`vscode-remote` URI 只有在 authority 与当前连接一致时才能读取；
 * 否则请求可能由当前远程主机按相同路径处理。
 * 其他受支持协议交给对应的文件系统提供程序处理。
 *
 * @param uri - 待判断的资源 URI
 * @returns 当前窗口可安全调用 `workspace.fs` 时为 `true`
 */
export function isFsAccessible(uri: vscode.Uri): boolean {
  if (uri.scheme !== 'vscode-remote') {
    return true;
  }
  return currentRemoteAuthority() === uri.authority;
}
