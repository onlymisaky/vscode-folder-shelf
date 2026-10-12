import * as vscode from 'vscode';

/**
 * 扩展通用工具。
 * 注意：本文件内禁止 l10n.t(变量) —— l10n:extract（vscode-l10n-dev）只做静态提取、
 * 仅识别字面量实参，需要本地化的文案一律由调用方以 l10n.t(字面量) 翻译后作为参数传入。
 */

/**
 * 生成输入框校验器：名称不能为空白（validateInput 直接可用）。
 * 不保留任何保留名——「未加标签」「未分组」等虚拟节点由 Entry kind 标识，
 * 真实名称允许与它们同名（树上以 tooltip 区分）。
 */
export function createNameValidator(
  emptyMessage: string
): (value: string) => string | undefined {
  return (value: string) => (value.trim() === '' ? emptyMessage : undefined);
}

/**
 * 重命名通用流程：预填当前名的输入框（校验非空白）→ 首尾去空 →
 * 空白或未变化即取消，确有新名才执行 apply（收到去空后的新名称）。
 * title / emptyMessage 均为调用方已翻译文案。
 */
export async function renameViaInputBox(
  currentName: string,
  options: { title: string; emptyMessage: string },
  apply: (newName: string) => Promise<unknown>
): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: options.title,
    value: currentName,
    validateInput: createNameValidator(options.emptyMessage),
  });
  // 输入统一首尾去空后再比较与保存
  const trimmed = name?.trim() ?? '';
  if (trimmed === '' || trimmed === currentName) {
    return;
  }
  await apply(trimmed);
}

/**
 * 危险操作确认：模态警告框 + 单个确认按钮。
 * 返回用户是否点了确认按钮（Esc / 关闭 / 取消均视为否）。
 * message / confirmLabel 均为调用方已翻译文案。
 */
export async function confirmDanger(
  message: string,
  confirmLabel: string
): Promise<boolean> {
  const CONFIRM: vscode.MessageItem = { title: confirmLabel };
  const confirmed = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    CONFIRM
  );
  return confirmed === CONFIRM;
}
