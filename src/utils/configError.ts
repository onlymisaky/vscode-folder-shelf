import * as vscode from 'vscode';
import { ConfigFileError } from '../services/configFileError';
import { openConfigGuide } from './configGuide';
import { OPEN_CONFIG_FILE_COMMAND } from '../commands';

/** 已显示过提示的错误实例，用于避免同一配置错误重复弹窗。 */
const reported = new WeakSet<ConfigFileError>();

/**
 * 显示配置文件错误及修复入口。同一个错误实例只提示一次；框架文本经过本地化，
 * Zod 或 `JSON.parse` 提供的原始诊断保持不变。
 *
 * @param error - 树配置文件读取错误
 * @returns 表示提示已关闭或所选操作已完成的 Promise
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
    await vscode.commands.executeCommand(OPEN_CONFIG_FILE_COMMAND.id, {
      line: error.line,
      column: error.column,
    });
  } else if (choice === GUIDE) {
    await openConfigGuide();
  }
}
