import * as vscode from 'vscode';

/** 配置文件错误的类别 */
export type ConfigFileErrorKind = 'json-syntax' | 'invalid-top-level' | 'invalid-items';

/** 结构错误的类别（不含语法错误） */
export type ConfigSchemaErrorKind = Exclude<ConfigFileErrorKind, 'json-syntax'>;

/**
 * config.json 读取失败（JSON 语法错误或结构不符 schema）：携带错误类别、文件路径、
 * 语法错误的行列位置与根源描述（zod / JSON.parse 英文原文）。
 * FolderStore 会把该错误缓存到 refresh/setFile 为止（同一读取代内抛同一错误对象），
 * 期间所有写操作拒绝执行（fail-closed，避免用新内容覆盖损坏文件）；
 * UI 层捕获后经 reportConfigFileError 弹窗展示定位信息并引导修复。
 */
export class ConfigFileError extends Error {
  /** 错误类别 */
  readonly kind: ConfigFileErrorKind;
  /** 配置文件路径（弹窗展示用） */
  readonly filePath: string;
  /** 根源描述（英文原文） */
  readonly detail: string;
  /** JSON 语法错误的 1-based 行号；结构错误为 undefined */
  readonly line: number | undefined;
  /** JSON 语法错误的 1-based 列号；结构错误为 undefined */
  readonly column: number | undefined;

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
   * JSON 语法错误工厂：从 JSON.parse 的报错信息提取字符偏移并换算行列。
   * V8 报错形如 "… at position 96"（较新版本还会附带 "(line 4 column 5)"，此处自行换算以保证可用）。
   *
   * @param text - 已解码（且已剥离 BOM）的文件全文
   * @param cause - JSON.parse 抛出的原始错误
   * @param fileUri - 配置文件 Uri
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
   * 结构错误工厂（顶层非对象 / items 非数组）：行列未知，根源为 zod issue 文本。
   *
   * @param kind - 结构错误类别
   * @param detail - zod issues 拼接的根源文本
   * @param fileUri - 配置文件 Uri
   */
  static schemaFailed(
    kind: ConfigSchemaErrorKind,
    detail: string,
    fileUri: vscode.Uri
  ): ConfigFileError {
    return new ConfigFileError(kind, fileUri, detail);
  }
}
