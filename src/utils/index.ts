import * as vscode from 'vscode';

/** 通用重命名输入框的本地化文案配置。 */
export interface RenameInputOptions {
  /** 输入框标题；必须由调用方提前完成本地化 */
  readonly title: string;
  /** 输入为空白时的校验提示；必须由调用方提前完成本地化 */
  readonly emptyMessage: string;
}

/**
 * 生成输入框校验器：名称不能为空白（validateInput 直接可用）。
 * 不保留任何保留名——「未加标签」「未分组」等虚拟节点由 Entry kind 标识，
 * 真实名称允许与它们同名（树上以 tooltip 区分）。
 *
 * @param emptyMessage - 校验失败时的提示文案（须为调用方已翻译文案）
 * @returns 输入校验函数：入参为当前输入值，空白（含纯空格）时返回提示文案，否则返回 undefined 表示通过
 */
export function createNameValidator(
  emptyMessage: string
): (value: string) => string | undefined {
  return (value: string) => (value.trim() === '' ? emptyMessage : undefined);
}

/**
 * 重命名通用流程：预填当前名的输入框（校验非空白）→ 首尾去空 →
 * 空白或未变化即取消，确有新名才执行 apply（收到去空后的新名称）。
 *
 * @param currentName - 当前名称（预填入输入框）
 * @param options - 文案配置：title 为输入框标题，emptyMessage 为空白校验提示（均须为已翻译文案）
 * @param apply - 应用新名称的回调：入参为去空后的新名称，仅在与现名不同且非空白时调用
 */
export async function renameViaInputBox(
  currentName: string,
  options: RenameInputOptions,
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
 *
 * @param message - 警告内容（须为已翻译文案）
 * @param confirmLabel - 确认按钮文字（须为已翻译文案）
 * @returns 用户是否点了确认按钮（Esc / 关闭 / 取消均视为否）
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
