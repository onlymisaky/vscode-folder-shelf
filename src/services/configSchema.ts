import { z } from 'zod';

/**
 * `config.json` 的校验规则。顶层对象和条目均保留未知字段，避免写回配置时丢失
 * 扩展无法识别的数据。条目只强制要求 `path` 为非空字符串；`group` 和 `tags`
 * 在读取时单独判断，使可选字段出错时条目仍可显示。
 */

/** 配置文件顶层结构；`items` 可省略，其他字段原样保留。 */
export const rawFileSchema = z.looseObject({
  items: z.array(z.unknown()).optional(),
});

/** 条目结构；`path` 必须为非空字符串，其他字段原样保留。 */
export const itemSchema = z.looseObject({
  path: z.string().min(1),
});

/** 已通过 {@link itemSchema} 校验且保留未知字段的条目。 */
export type UsableItem = z.infer<typeof itemSchema>;

/** 格式化校验错误所需的最小 Zod issue 结构。 */
interface IssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * 将 Zod 校验问题格式化为单行文本。
 *
 * @param issues - `safeParse` 返回的问题列表
 * @returns 以 `; ` 分隔的“路径: 消息”文本
 */
export function formatIssues(issues: readonly IssueLike[]): string {
  return issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/**
 * 根据问题路径区分顶层对象错误和 `items` 字段错误。
 *
 * @param issues - {@link rawFileSchema} 返回的问题列表
 * @returns 对应的配置结构错误类别
 */
export function topLevelErrorKind(
  issues: readonly IssueLike[]
): 'invalid-top-level' | 'invalid-items' {
  return issues.some((issue) => issue.path.includes('items'))
    ? 'invalid-items'
    : 'invalid-top-level';
}
