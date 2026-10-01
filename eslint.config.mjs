import tseslint from 'typescript-eslint';

/** TypeScript 源码使用的 ESLint 扁平配置。 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '*.vsix'] },
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((configuration) => ({
    ...configuration,
    files: ['**/*.ts']
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true
      }
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-floating-promises': 'error'
    }
  }
);
