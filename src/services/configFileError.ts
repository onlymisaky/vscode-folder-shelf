import * as vscode from 'vscode';

/** 配置文件的语法或结构错误类别。 */
export type ConfigFileErrorKind = 'json-syntax' | 'invalid-top-level' | 'invalid-items';

/** 配置文件结构错误类别，不含 JSON 语法错误。 */
export type ConfigSchemaErrorKind = Exclude<ConfigFileErrorKind, 'json-syntax'>;

/**
 * 表示 `config.json` 的 JSON 语法错误或结构错误。错误包含文件位置和原始诊断信息；
 * {@link FolderStore} 会缓存该实例并暂停写入，直到用户刷新或切换配置文件。
 */
export class ConfigFileError extends Error {
  /** 错误类别。 */
  readonly kind: ConfigFileErrorKind;
  /** 用于错误提示的配置文件路径。 */
  readonly filePath: string;
  /** 底层解析器返回的原始错误信息。 */
  readonly detail: string;
  /** JSON 语法错误的行号，从 1 开始；结构错误时为 `undefined`。 */
  readonly line: number | undefined;
  /** JSON 语法错误的列号，从 1 开始；结构错误时为 `undefined`。 */
  readonly column: number | undefined;

  /**
   * 创建配置文件错误。
   *
   * @param kind - 错误类别
   * @param fileUri - 出错的配置文件 URI
   * @param detail - 原始错误信息
   * @param line - 从 1 开始的行号，仅语法错误可能提供
   * @param column - 从 1 开始的列号，仅语法错误可能提供
   */
  private constructor(
    kind: ConfigFileErrorKind,
    fileUri: vscode.Uri,
    detail: string,
    line?: number,
    column?: number
  ) {
    super(detail);
    this.name = 'ConfigFileError';
    this.kind = kind;
    this.filePath = fileUri.fsPath;
    this.detail = detail;
    this.line = line;
    this.column = column;
  }

  /**
   * 根据 `JSON.parse` 错误创建语法错误，并在错误包含字符偏移时计算行列。
   *
   * @param text - 已解码且已移除 BOM 的文件内容
   * @param cause - `JSON.parse` 抛出的错误
   * @param fileUri - 配置文件 URI
   * @returns 包含可用行列信息的语法错误
   */
  static parseFailed(text: string, cause: unknown, fileUri: vscode.Uri): ConfigFileError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const match = /position (\d+)/i.exec(detail);
    let line: number | undefined;
    let column: number | undefined;
    if (match) {
      const offset = Number(match[1]);
      if (offset <= text.length) {
        const before = text.slice(0, offset);
        line = (before.match(/\n/g)?.length ?? 0) + 1;
        column = offset - before.lastIndexOf('\n');
      }
    }
    return new ConfigFileError('json-syntax', fileUri, detail, line, column);
  }

  /**
   * 根据 Zod 校验结果创建配置结构错误。
   *
   * @param kind - 结构错误类别
   * @param detail - 已格式化的 Zod 问题文本
   * @param fileUri - 配置文件 URI
   * @returns 不含行列信息的结构错误
   */
  static schemaFailed(
    kind: ConfigSchemaErrorKind,
    detail: string,
    fileUri: vscode.Uri
  ): ConfigFileError {
    return new ConfigFileError(kind, fileUri, detail);
  }
}
