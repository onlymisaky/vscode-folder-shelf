import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import type { JSRuleDefinition, Linter, Rule } from 'eslint';
import type * as ESTree from 'estree';

/**
 * 内联规则：强制 l10n.t 的 message 实参可被 l10n:extract 静态提取。
 *
 * 行为矩阵按 @vscode/l10n-dev@0.0.35 提取器实测钉死：
 * - ✅ 提取：字符串字面量 / 无插值模板 / 数字字面量 / 带参调用（首个实参之后任意）/
 *   无插值的 tagged template（插值自动转 {0}）/
 *   对象形态 { message: 静态, comment: 字面量或字面量数组, args: 任意 }
 * - ❌ 静默丢失：变量/表达式/拼接/三元实参、无参调用、对象缺 message、
 *   对象缺静态 comment（提取器的 tree-sitter 模式要求 message 与 comment 两个 pair 同时存在）
 * - 💥 直接抛错（整个 export 失败）：l10n.t(`含插值`) 普通调用形态
 */
const staticMessageRule: JSRuleDefinition = {
  meta: {
    type: 'problem',
    docs: { description: 'l10n.t 的 message 实参必须可被 l10n:extract 静态提取' },
    schema: [],
    messages: {
      dynamicMessage:
        'l10n.t() 的首个实参必须为字符串字面量 / 无插值模板 / 数字字面量：l10n:extract 只做静态提取，变量与表达式会被静默丢弃，运行时表现为未翻译',
      templateSubstitution:
        "l10n.t(模板字符串) 含插值会使 l10n:extract 直接抛错；请改写为 l10n.t('{0}', x) 形式",
      missingMessage: 'l10n.t() 缺少 message 实参，无法静态提取',
      missingMessageProp: 'l10n.t(对象) 缺少 message 属性，无法静态提取',
      objectMissingComment:
        "l10n:extract 仅提取同时含静态 message 与静态 comment 的对象形态，请补 comment: ['…'] 或改用字符串实参",
      dynamicComment:
        'comment 必须是字符串字面量或字面量数组，否则该条目会被 l10n:extract 静默丢弃',
    },
  },
  create(context): Rule.RuleListener {
    /** 识别 l10n.t / vscode.l10n.t 的 callee（覆盖 vscode 与 @vscode/l10n 两种来源） */
    const isL10nTCallee = (node: ESTree.Node | undefined): boolean => {
      if (node?.type !== 'MemberExpression') {
        return false;
      }
      if (node.property.type !== 'Identifier' || node.property.name !== 't') {
        return false;
      }
      const obj = node.object;
      if (obj.type === 'Identifier') {
        return obj.name === 'l10n';
      }
      return (
        obj.type === 'MemberExpression' &&
        obj.object.type === 'Identifier' &&
        obj.object.name === 'vscode' &&
        obj.property.type === 'Identifier' &&
        obj.property.name === 'l10n'
      );
    };
    /** 可被提取器识别的静态文案：字符串/数字字面量、无插值模板 */
    const isStaticText = (node: ESTree.Node): boolean =>
      (node.type === 'Literal' &&
        (typeof node.value === 'string' || typeof node.value === 'number')) ||
      (node.type === 'TemplateLiteral' && node.expressions.length === 0);
    /** 静态 comment：字符串字面量（或无插值模板）、字面量数组 */
    const isStaticComment = (node: ESTree.Node): boolean =>
      isStaticText(node) ||
      (node.type === 'ArrayExpression' &&
        node.elements.every((element) => element !== null && isStaticText(element)));

    const checkObjectForm = (objectNode: ESTree.ObjectExpression): void => {
      const properties = objectNode.properties;
      const findProp = (name: string): ESTree.Property | undefined =>
        properties.find(
          (prop): prop is ESTree.Property =>
            prop.type === 'Property' &&
            !prop.computed &&
            prop.key.type === 'Identifier' &&
            prop.key.name === name
        );
      const message = findProp('message');
      if (message === undefined) {
        context.report({ node: objectNode, messageId: 'missingMessageProp' });
        return;
      }
      if (!isStaticText(message.value)) {
        context.report({ node: message.value, messageId: 'dynamicMessage' });
        return;
      }
      const comment = findProp('comment');
      if (comment === undefined) {
        context.report({ node: objectNode, messageId: 'objectMissingComment' });
      } else if (!isStaticComment(comment.value)) {
        context.report({ node: comment.value, messageId: 'dynamicComment' });
      }
    };

    return {
      CallExpression(node): void {
        if (!isL10nTCallee(node.callee)) {
          return;
        }
        const [messageArg] = node.arguments;
        if (messageArg === undefined) {
          context.report({ node, messageId: 'missingMessage' });
        } else if (isStaticText(messageArg)) {
          // 静态文案，后续实参任意
        } else if (messageArg.type === 'TemplateLiteral') {
          context.report({ node: messageArg, messageId: 'templateSubstitution' });
        } else if (messageArg.type === 'ObjectExpression') {
          checkObjectForm(messageArg);
        } else {
          context.report({ node: messageArg, messageId: 'dynamicMessage' });
        }
      },
      // tagged template（l10n.t`…`）：提取器把插值自动转成 {0} 占位符，无需检查
    };
  },
};

const l10nStaticPlugin = {
  meta: { name: 'eslint-plugin-local-l10n-static' },
  rules: { 'static-message': staticMessageRule },
};

/** TypeScript 源码使用的 ESLint 扁平配置。 */
export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', '*.vsix'] },
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map(
    (configuration): Linter.Config => ({
      ...configuration,
      files: ['**/*.ts'],
    })
  ),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true
      }
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'local-l10n-static/static-message': 'error'
    },
    plugins: {
      'local-l10n-static': l10nStaticPlugin
    }
  }
);
