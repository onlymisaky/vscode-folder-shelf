import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import type { JSRuleDefinition, Linter, Rule } from 'eslint';
import type * as ESTree from 'estree';

/**
 * 检查 `l10n.t` 的消息参数能否被 `l10n:extract` 静态提取。
 *
 * `@vscode/l10n-dev@0.0.35` 支持字符串、数字、无插值模板和带静态 `message`、
 * `comment` 的对象。动态表达式会被忽略，普通模板字符串中的插值会导致提取失败。
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
  /**
   * 创建本地化消息检查器。
   *
   * @param context - ESLint 规则上下文
   * @returns AST 节点监听器
   */
  create(context): Rule.RuleListener {
    /**
     * 判断节点是否为 `l10n.t` 或 `vscode.l10n.t` 调用目标。
     *
     * @param node - 待检查节点
     * @returns 节点为受支持的本地化调用目标时为 `true`
     */
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
    /**
     * 判断节点是否为提取器支持的静态文本。
     *
     * @param node - 待检查节点
     * @returns 节点为字符串、数字或无插值模板时为 `true`
     */
    const isStaticText = (node: ESTree.Node): boolean =>
      (node.type === 'Literal' &&
        (typeof node.value === 'string' || typeof node.value === 'number')) ||
      (node.type === 'TemplateLiteral' && node.expressions.length === 0);
    /**
     * 判断节点是否为有效的静态翻译注释。
     *
     * @param node - 待检查节点
     * @returns 节点为静态文本或静态文本数组时为 `true`
     */
    const isStaticComment = (node: ESTree.Node): boolean =>
      isStaticText(node) ||
      (node.type === 'ArrayExpression' &&
        node.elements.every((element) => element !== null && isStaticText(element)));

    /**
     * 检查对象形式的本地化参数是否包含静态 `message` 和 `comment`。
     *
     * @param objectNode - `l10n.t` 的对象参数
     */
    const checkObjectForm = (objectNode: ESTree.ObjectExpression): void => {
      const properties = objectNode.properties;
      /**
       * 按名称查找对象中的非计算属性。
       *
       * @param name - 属性名
       * @returns 匹配的属性；未找到时为 `undefined`
       */
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
      /**
       * 检查每个本地化函数调用的首个参数。
       *
       * @param node - 函数调用节点
       */
      CallExpression(node): void {
        if (!isL10nTCallee(node.callee)) {
          return;
        }
        const [messageArg] = node.arguments;
        if (messageArg === undefined) {
          context.report({ node, messageId: 'missingMessage' });
        } else if (isStaticText(messageArg)) {
          // 首个参数可提取，后续参数仅用于替换占位符。
        } else if (messageArg.type === 'TemplateLiteral') {
          context.report({ node: messageArg, messageId: 'templateSubstitution' });
        } else if (messageArg.type === 'ObjectExpression') {
          checkObjectForm(messageArg);
        } else {
          context.report({ node: messageArg, messageId: 'dynamicMessage' });
        }
      },
      // 标签模板由提取器自动将插值转换为占位符，无需额外检查。
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
