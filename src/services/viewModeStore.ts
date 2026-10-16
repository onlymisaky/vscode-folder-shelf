import * as vscode from 'vscode';

/** 树支持的平铺、标签和分组展示模式。 */
export type ViewMode = 'flat' | 'tagged' | 'grouped';

/** 在 `globalState` 中保存视图模式的键。 */
const MEMENTO_KEY = 'folderShelf.viewMode';

/** 标题栏按钮切换视图模式时使用的循环顺序。 */
const VIEW_MODE_CYCLE: readonly ViewMode[] = ['flat', 'tagged', 'grouped'];

/** 当前视图为平铺模式时置为 `true` 的上下文键。 */
export const FLAT_VIEW_CONTEXT_KEY = 'folderShelf.flatView';
/** 当前视图为标签模式时置为 `true` 的上下文键。 */
export const TAGGED_VIEW_CONTEXT_KEY = 'folderShelf.taggedView';
/** 当前视图为分组模式时置为 `true` 的上下文键。 */
export const GROUPED_VIEW_CONTEXT_KEY = 'folderShelf.groupedView';

/**
 * 保存当前视图模式，并同步持久化状态和菜单使用的上下文键。
 */
export class ViewModeStore implements vscode.Disposable {
  /** 视图模式实际改变后触发的事件发射器。 */
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** 供树视图订阅的模式变更事件。 */
  readonly onDidChange = this._onDidChange.event;

  /** 当前生效的模式；`globalState` 仅用于跨重启恢复。 */
  private current: ViewMode;

  /**
   * 创建展示模式存储，并恢复上次持久化的模式。
   *
   * @param memento - 扩展级全局状态存储
   */
  constructor(private readonly memento: vscode.Memento) {
    this.current = memento.get<ViewMode>(MEMENTO_KEY, 'flat');
    this.syncContextKey();
  }

  /**
   * 获取当前展示模式。
   *
   * @returns 当前生效的视图模式
   */
  get mode(): ViewMode {
    return this.current;
  }

  /**
   * 设置展示模式：与当前相同则忽略；否则更新内存、写 globalState、同步上下文键并触发变更事件。
   *
   * @param mode - 目标视图模式；与当前模式相同时不执行更新
   */
  set(mode: ViewMode): void {
    if (mode === this.current) {
      return;
    }
    this.current = mode;
    void this.memento.update(MEMENTO_KEY, mode);
    this.syncContextKey();
    this._onDidChange.fire();
  }

  /**
   * 按固定循环顺序切换到下一个展示模式（平铺 → 标签 → 分组 → 平铺）。
   */
  switch(): void {
    const index = VIEW_MODE_CYCLE.indexOf(this.current);
    const mode = VIEW_MODE_CYCLE[(index + 1) % VIEW_MODE_CYCLE.length] as ViewMode;
    this.set(mode);
  }

  /** 释放模式变更事件发射器。 */
  dispose(): void {
    this._onDidChange.dispose();
  }

  /**
   * 同步三个互斥的视图模式上下文键。
   */
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
