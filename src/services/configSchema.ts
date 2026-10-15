import { z } from 'zod';

/**
 * config.json 的校验 schema。
 *
 * 设计取舍（与「保留原始内容」配套）：
 * - 顶层与条目均使用 looseObject：未知字段不校验、不剔除，随解析产物原样保留，commit 写回时不丢失。
 * - itemSchema 仅严格约束 path（必填非空字符串）；group/tags 的类型宽松处理
 *   （渲染时守卫，类型不符显示为未分组/无标签），避免单个可选字段写错导致整条收藏从视图消失。
 */

/** 顶层结构：items 可选数组；looseObject 保留全部未知顶层字段 */
export const rawFileSchema = z.looseObject({
  items: z.array(z.unknown()).optional(),
});

/** 单条目：仅严格约束 path（必填非空字符串）；looseObject 保留条目未知字段 */
export const itemSchema = z.looseObject({
  path: z.string().min(1),
});

/** 通过校验的条目（looseObject 产物，未知字段随对象原样保留） */
export type UsableItem = z.infer<typeof itemSchema>;

/** zod issue 的结构子集（避免依赖 zod 内部类型导出路径） */
interface IssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * 把 zod issues 拼成单行根源文本（英文原文直接展示，不做翻译）。
 *
 * @param issues - safeParse 失败产生的 issue 列表
 * @returns 以 "; " 连接的 "路径: 消息" 文本，如 `items[2].path: Invalid input: expected string, received number`
 */
export function formatIssues(issues: readonly IssueLike[]): string {
  return issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/**
 * 判定顶层校验失败的错误类别：issue 路径含 items → items 非数组，否则顶层非对象。
 *
 * @param issues - rawFileSchema 校验失败产生的 issue 列表
 * @returns 对应的 ConfigFileError 类别（json-syntax 之外）
 */
export function topLevelErrorKind(
  issues: readonly IssueLike[]
): 'invalid-top-level' | 'invalid-items' {
  return issues.some((issue) => issue.path.includes('items'))
    ? 'invalid-items'
    : 'invalid-top-level';
}
