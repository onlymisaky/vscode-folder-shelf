import * as vscode from 'vscode';

/** 视图展示模式：平铺列表 / 按分组展示 */
export type ViewMode = 'flat' | 'grouped';

/** globalState 存储键（UI 偏好，不写入用户数据 config.json） */
const MEMENTO_KEY = 'folderShelf.viewMode';

/** when 子句用的上下文键：分组展示模式是否开启 */
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
    const viewModes: ViewMode[] = ['flat', 'grouped'];
    const index = viewModes.indexOf(this.current);
    const mode = viewModes[(index + 1) % viewModes.length] as ViewMode;
    this.set(mode);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  private syncContextKey(): void {
    void vscode.commands.executeCommand(
      'setContext',
      GROUPED_VIEW_CONTEXT_KEY,
      this.current === 'grouped'
    );
  }
}
