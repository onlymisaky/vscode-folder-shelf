import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] 构建开始');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] 构建完成');
    });
  },
};

/**
 * 扩展入口的统一 esbuild 构建配置
 * @type {Parameters<typeof esbuild.context>[0]}
 */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: watch ? false : true,
  minify: watch ? false : true,
  logLevel: 'info',
  plugins: [
    esbuildProblemMatcherPlugin
  ]
};

try {
  const context = await esbuild.context(options);
  if (watch) {
    await context.watch();
  } else {
    await context.rebuild();
    await context.dispose();
  }
} catch (error) {
  console.error('构建失败:', error);
  process.exit(1);
}
