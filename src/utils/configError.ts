import * as vscode from 'vscode';
import { ConfigFileError } from '../services/configFileError';
import { openConfigGuide } from './configGuide';
import { OPEN_CONFIG_FILE_COMMAND } from '../commands';

/** 已弹过窗的错误对象（store 在同一读取代内缓存同一错误对象，据此去重避免刷屏） */
const reported = new WeakSet<ConfigFileError>();

/**
 * 上报配置文件错误：弹出含错误类型、位置与根源的非模态错误框（同一错误对象仅弹一次），
 * 并提供「打开配置文件」按钮跳转修复。
 * 主文案为本地化框架信息；根源 detail 为 zod / JSON.parse 的英文原文，直接展示不做翻译。
 *
 * @param error - FolderStore 读取配置文件失败的 ConfigFileError
 * @returns 用户点击「打开配置文件」并完成打开（或用户关闭弹窗）后 resolve
 */
export async function reportConfigFileError(error: ConfigFileError): Promise<void> {
  if (reported.has(error)) {
    return;
  }
  reported.add(error);

  const headline = error.kind === 'json-syntax'
    ? vscode.l10n.t('Failed to parse the config file: JSON syntax error')
    : error.kind === 'invalid-top-level'
      ? vscode.l10n.t('Config file structure error: the top level must be a JSON object')
      : vscode.l10n.t('Config file structure error: "items" must be an array');

  const lines = [headline];
  if (error.line !== undefined && error.column !== undefined) {
    lines.push(vscode.l10n.t('Line {0}, Column {1}', error.line, error.column));
  }
  lines.push(vscode.l10n.t('File: {0}', error.filePath));
  lines.push(vscode.l10n.t('Reason: {0}', error.detail));

  const OPEN: vscode.MessageItem = { title: vscode.l10n.t('Open Config File') };
  const GUIDE: vscode.MessageItem = { title: vscode.l10n.t('View Config Guide') };
  const choice = await vscode.window.showErrorMessage(lines.join('\n'), OPEN, GUIDE);
  if (choice === OPEN) {
    // 经命令 ID 调用，避免与 commands 层相互 import 形成环依赖；
    // 携带 1 基行列供命令把光标直接定位到错误处（结构错误无行列，缺省不定位）
    await vscode.commands.executeCommand(OPEN_CONFIG_FILE_COMMAND.id, {
      line: error.line,
      column: error.column,
    });
  } else if (choice === GUIDE) {
    await openConfigGuide();
  }
}
