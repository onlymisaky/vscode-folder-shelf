/**
 * 构建期内联，同步返回，零 IO、无失败路径；
 */
import * as vscode from 'vscode';

// 构建期内联指南文档（esbuild text loader），运行时同步选择语言
import guideBundled from '../../resources/docs/config-guide.md';
import guideBundledZhCn from '../../resources/docs/config-guide.zh-cn.md';

/**
 * 语言 → 内联文档映射。语言取值与 vscode.l10n.language 一致（如 'zh-cn'），
 * 未命中的语言回退到默认文档（源语言）。新增语言：添加 md 文件并在此注册。
 */
const GUIDE_BUNDLED_LOCALES: Record<string, string> = {
  'zh-cn': guideBundledZhCn,
};

/** 按当前 UI 语言解析内联指南，未命中时回退默认文档 */
export function resolveBundledGuide(): string {
  const lang = vscode.env.language.toLowerCase();
  return (lang && GUIDE_BUNDLED_LOCALES[lang]) || guideBundled;
}
