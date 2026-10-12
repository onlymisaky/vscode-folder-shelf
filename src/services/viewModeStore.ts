import * as vscode from 'vscode';

/** 视图展示模式：平铺列表 / 按标签展示 / 按分组展示 */
export type ViewMode = 'flat' | 'tagged' | 'grouped';

/** globalState 存储键（UI 偏好，不写入用户数据 config.json） */
const MEMENTO_KEY = 'folderShelf.viewMode';

/** 标题栏切换按钮的循环顺序：平铺 → 标签 → 分组 */
const VIEW_MODE_CYCLE: readonly ViewMode[] = ['flat', 'tagged', 'grouped'];

/** when 子句用的上下文键：当前展示模式（三态互斥，三键同步维护，供标题栏按钮与命令面板 when 过滤） */
export const FLAT_VIEW_CONTEXT_KEY = 'folderShelf.flatView';
export const TAGGED_VIEW_CONTEXT_KEY = 'folderShelf.taggedView';
export const GROUPED_VIEW_CONTEXT_KEY = 'folderShelf.groupedView';

/** 视图展示模式的持久化：读同步（激活时零开销）、切换即写 globalState 并同步上下文键。 */
export class ViewModeStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  /** 内存为准（切换立即生效），globalState 仅作跨重启持久化 */
  private current: ViewMode;

  constructor(private readonly memento: vscode.Memento) {
    this.current = memento.get<ViewMode>(MEMENTO_KEY, 'flat');
    this.syncContextKey();
  }

  get mode(): ViewMode {
    return this.current;
  }

  set(mode: ViewMode): void {
    if (mode === this.current) {
      return;
    }
    this.current = mode;
    void this.memento.update(MEMENTO_KEY, mode);
    this.syncContextKey();
    this._onDidChange.fire();
  }

  switch(): void {
    const index = VIEW_MODE_CYCLE.indexOf(this.current);
    const mode = VIEW_MODE_CYCLE[(index + 1) % VIEW_MODE_CYCLE.length] as ViewMode;
    this.set(mode);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  private syncContextKey(): void {
    const states: ReadonlyArray<readonly [string, boolean]> = [
      [FLAT_VIEW_CONTEXT_KEY, this.current === 'flat'],
      [TAGGED_VIEW_CONTEXT_KEY, this.current === 'tagged'],
      [GROUPED_VIEW_CONTEXT_KEY, this.current === 'grouped'],
    ];
    for (const [key, value] of states) {
      void vscode.commands.executeCommand('setContext', key, value);
    }
  }
}
