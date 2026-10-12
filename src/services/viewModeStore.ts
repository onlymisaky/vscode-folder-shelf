import * as vscode from 'vscode';

/** 视图展示模式：平铺列表 / 按标签展示 / 按分组展示 */
export type ViewMode = 'flat' | 'tagged' | 'grouped';

/** globalState 存储键（UI 偏好，不写入用户数据 config.json），值为 ViewMode 字符串 */
const MEMENTO_KEY = 'folderShelf.viewMode';

/** 标题栏切换按钮的循环顺序：平铺 → 标签 → 分组（switch 按此顺序循环取下一模式） */
const VIEW_MODE_CYCLE: readonly ViewMode[] = ['flat', 'tagged', 'grouped'];

/** when 子句用的上下文键：当前展示模式为平铺（三态互斥，三键同步维护，供标题栏按钮与命令面板 when 过滤） */
export const FLAT_VIEW_CONTEXT_KEY = 'folderShelf.flatView';
/** when 子句用的上下文键：当前展示模式为标签 */
export const TAGGED_VIEW_CONTEXT_KEY = 'folderShelf.taggedView';
/** when 子句用的上下文键：当前展示模式为分组 */
export const GROUPED_VIEW_CONTEXT_KEY = 'folderShelf.groupedView';

/**
 * 视图展示模式的持久化：读同步（构造时从 globalState 载入，激活零开销），
 * 切换即写 globalState 并同步三个 when 上下文键。
 */
export class ViewModeStore implements vscode.Disposable {
  /** 模式变更事件发射器（set 成功后触发） */
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** 模式变更事件（树视图订阅后重建根层级） */
  readonly onDidChange = this._onDidChange.event;

  /** 内存为准（切换立即生效），globalState 仅作跨重启持久化 */
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
   * @returns 当前生效的平铺、标签或分组模式
   */
  get mode(): ViewMode {
    return this.current;
  }

  /**
   * 设置展示模式：与当前相同则忽略；否则更新内存、写 globalState、同步上下文键并触发变更事件。
   *
   * @param mode - 目标展示模式（flat / tagged / grouped 三选一）
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

  /** 释放事件发射器（扩展停用时由 context.subscriptions 统一调用）。 */
  dispose(): void {
    this._onDidChange.dispose();
  }

  /**
   * 将三个互斥的 when 上下文键同步为当前模式（任意时刻恒恰好一键为 true）。
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
