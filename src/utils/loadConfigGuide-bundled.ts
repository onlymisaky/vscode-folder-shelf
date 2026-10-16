import * as vscode from 'vscode';
import guideBundled from '../../resources/docs/config-guide.md';
import guideBundledZhCn from '../../resources/docs/config-guide.zh-cn.md';

const GUIDE_BUNDLED_LOCALES: Record<string, string> = {
  'zh-cn': guideBundledZhCn,
};

/**
 * 返回当前界面语言对应的内联指南。
 *
 * @returns 匹配的指南文本；没有对应语言时为默认指南
 */
export function resolveBundledGuide(): string {
  const lang = vscode.env.language.toLowerCase();
  return (lang && GUIDE_BUNDLED_LOCALES[lang]) || guideBundled;
}
