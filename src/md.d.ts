/** esbuild text loader：构建期将 .md 文件按 UTF-8 文本内联为字符串（默认导出） */
declare module '*.md' {
  const content: string;
  export default content;
}
