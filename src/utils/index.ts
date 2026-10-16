import * as vscode from 'vscode';

/** 通用编辑输入框的文案配置。 */
export interface EditInputOptions {
  /** 输入框标题 */
  readonly title: string;
  /** 输入为空白时的校验提示 */
  readonly emptyMessage: string;
}

/**
 * 创建校验值不能为空白的输入校验函数，去除首尾空白后为空即视为无效。
 *
 * @param emptyMessage - 值为空白时显示的提示
 * @returns 可直接传给 `validateInput` 的校验函数
 */
export function createRequiredValidator(
  emptyMessage: string
): (value: string) => string | undefined {
  return (value: string) => (value.trim() === '' ? emptyMessage : undefined);
}

/**
 * 显示预填当前值的输入框，并在值有效且发生变化时应用修改
 *
 * @param currentValue - 输入框中预填的当前值
 * @param options - 标题和校验提示
 * @param apply - 接收去除首尾空白后新值的异步回调
 * @returns 表示用户已取消或修改已完成的 Promise
 */
export async function editViaInputBox(
  currentValue: string,
  options: EditInputOptions,
  apply: (newValue: string) => Promise<unknown>
): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: options.title,
    value: currentValue,
    validateInput: createRequiredValidator(options.emptyMessage),
  });
  // 比较和保存前统一去除首尾空白
  const trimmed = value?.trim() ?? '';
  if (trimmed === '' || trimmed === currentValue) {
    return;
  }
  await apply(trimmed);
}

/**
 * 显示带单个确认按钮的模态警告框
 *
 * @param message - 警告内容
 * @param confirmLabel - 确认按钮文本
 * @returns 用户点击确认按钮时为 `true`；关闭弹窗时为 `false`
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

export * from './quickPick';
export * from './configError';
export * from './itemUri';
