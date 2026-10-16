import * as vscode from 'vscode';

/** createQuickPick 原生属性，直接支持在配置项中设置。 */
type NativePickerOptions<T extends vscode.QuickPickItem> = Partial<
  Pick<
    vscode.QuickPick<T>,
    | 'ignoreFocusOut'
    | 'matchOnDescription'
    | 'matchOnDetail'
    | 'keepScrollPosition'
    | 'buttons'
    | 'step'
    | 'totalSteps'
  >
>;

const MANAGED_KEYS = ['items', 'canSelectMany', 'selectedItems', 'value', 'activeItems'] as const;

/**
 * 暴露给配置回调的选择器类型。内部维护的属性从类型中移除，运行时由 {@link guardPicker} 阻止写入。
 */
type ConfigurablePicker<T extends vscode.QuickPickItem> = Omit<
  vscode.QuickPick<T>,
  (typeof MANAGED_KEYS)[number]
>;

/** 显示选择器前可执行的额外配置。 */
type ConfigurePickerOptions<T extends vscode.QuickPickItem> = {
  readonly configure?: (picker: ConfigurablePicker<T>) => void;
};

/**
 * {@link showPicker} 的配置项，包括选择行为、直接支持的原生属性和额外配置回调。
 */
export interface PickerOptions<T extends vscode.QuickPickItem>
  extends NativePickerOptions<T>,
  ConfigurePickerOptions<T> {
  /** 选择器标题。 */
  readonly title: string;
  /** 输入占位文本。 */
  readonly placeholder?: string;
  /** 动态创建项的说明，例如“创建标签”。 */
  readonly createHint?: string;
  /**
   * 创建名称前是否去除首尾空白，默认为 `true`。设为 `false` 时保留原始输入，
   * 包括纯空白名称；仅在允许创建新项时生效。
   */
  readonly trimInput?: boolean;
  /**
   * 多选且允许创建时，将新名称转换为正式选择项。返回项的 `label` 必须等于名称，
   * 否则后续过滤无法匹配该项。
   */
  readonly buildCreatedItem?: (name: string) => T;
  /**
   * 多选模式初始勾选的名称。打开时按 `label` 精确匹配，未找到的名称会被忽略。
   */
  readonly checkedNames?: readonly string[];
}

/**
 * 允许创建时的单选结果：选择现有项，或确认创建一个新名称。
 */
export type CreateOrPick<T extends vscode.QuickPickItem> =
  | {
    /** 表示选择了现有项。 */
    readonly kind: 'picked';
    /** 被选中的项；动作项可由调用方按对象引用识别。 */
    readonly item: T;
  }
  | {
    /** 表示确认创建新名称。 */
    readonly kind: 'created';
    /** 新名称；默认已去除首尾空白。 */
    readonly name: string;
  };

/**
 * 显示支持单选、多选和动态创建的 Quick Pick。单选使用 VS Code 原生过滤；多选会保留
 * 全部项目并弱化未匹配项，使过滤时已有勾选不会丢失。允许创建时，输入非空且未使用的
 * 名称会在列表顶部生成创建项；多选可连续创建，单选确认后立即返回。
 *
 * @param items - 可选项；结果保留原对象及其业务字段
 * @param options - 选择器配置；模式标志需使用布尔字面量以匹配重载
 * @returns 选择结果；取消时为 `undefined`
 */
export function showPicker<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options: PickerOptions<T> & { canSelectMany: true; canAddItem: true; buildCreatedItem: (name: string) => T }
): Promise<T[] | undefined>;
export function showPicker<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options: PickerOptions<T> & { canSelectMany: true; canAddItem?: false }
): Promise<T[] | undefined>;
export function showPicker<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options: PickerOptions<T> & { canAddItem: true; canSelectMany?: false }
): Promise<CreateOrPick<T> | undefined>;
export function showPicker<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options: PickerOptions<T> & { canSelectMany?: false; canAddItem?: false }
): Promise<T | undefined>;
export function showPicker<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options: PickerOptions<T> & { canSelectMany?: boolean; canAddItem?: boolean }
): Promise<T[] | T | CreateOrPick<T> | undefined> {
  if (options.canSelectMany === true) {
    return runMultiPick(items, options);
  }
  return runSinglePick(items, options, options.canAddItem === true);
}

/**
 * 创建配置回调使用的代理，并阻止写入内部维护的选择器属性。
 *
 * @param picker - 原始选择器
 * @returns 允许额外配置但保护内部状态的代理
 */
function guardPicker<T extends vscode.QuickPickItem>(picker: vscode.QuickPick<T>): ConfigurablePicker<T> {
  return new Proxy(picker, {
    /**
     * 读取选择器属性，并将方法绑定到原始选择器。
     *
     * @param target - 原始选择器
     * @param prop - 要读取的属性键
     * @returns 属性值；函数值已绑定正确的 `this`
     */
    get(target, prop): unknown {
      const value: unknown = Reflect.get(target, prop, target);
      // VS Code 方法需要以原始选择器作为 `this`。
      return typeof value === 'function' ? value.bind(target) : value;
    },
    /**
     * 写入允许配置的属性，并拒绝修改内部维护的属性。
     *
     * @param target - 原始选择器
     * @param prop - 要写入的属性键
     * @param newValue - 新属性值
     * @returns 属性写入是否成功
     */
    set(target, prop, newValue): boolean {
      if (typeof prop === 'string' && (MANAGED_KEYS as readonly string[]).includes(prop)) {
        throw new Error(`showPicker: configure cannot set managed property "${prop}"`);
      }
      return Reflect.set(target, prop, newValue, target);
    },
  });
}

/**
 * 应用通用选择器属性，并执行额外配置回调。
 *
 * @param quickPick - 待配置的选择器
 * @param options - 通用配置项
 */
function applyBaseOptions<T extends vscode.QuickPickItem>(
  quickPick: vscode.QuickPick<T>,
  options: PickerOptions<T>
): void {
  quickPick.title = options.title;
  if (options.placeholder !== undefined) {
    quickPick.placeholder = options.placeholder;
  }
  quickPick.matchOnDescription = options.matchOnDescription ?? false;
  quickPick.matchOnDetail = options.matchOnDetail ?? false;
  if (options.ignoreFocusOut !== undefined) {
    quickPick.ignoreFocusOut = options.ignoreFocusOut;
  }
  if (options.keepScrollPosition !== undefined) {
    quickPick.keepScrollPosition = options.keepScrollPosition;
  }
  if (options.buttons !== undefined) {
    quickPick.buttons = options.buttons;
  }
  if (options.step !== undefined) {
    quickPick.step = options.step;
  }
  if (options.totalSteps !== undefined) {
    quickPick.totalSteps = options.totalSteps;
  }
  options.configure?.(guardPicker(quickPick));
}

/**
 * 创建显示在列表顶部的动态创建项。
 *
 * @param name - 新项名称，同时用作 `label`
 * @param hint - 可选的说明
 * @returns 始终显示的创建项
 */
function buildCreateItem(name: string, hint?: string): vscode.QuickPickItem {
  return {
    label: name,
    description: hint,
    iconPath: new vscode.ThemeIcon('plus'),
    alwaysShow: true,
  };
}

/**
 * 创建未匹配项的弱化副本，同时保留业务字段。
 *
 * @param item - 原始选择项
 * @returns 保持可见且使用弱化文本和图标的副本
 */
function dimItem<T extends vscode.QuickPickItem>(item: T): T {
  const icon = item.iconPath;
  // 
  const dimmed = icon instanceof vscode.ThemeIcon
    ? new vscode.ThemeIcon(icon.id, new vscode.ThemeColor('descriptionForeground'))
    : icon;
  // 展开原对象以保留调用方附加的业务字段。
  return { 
    ...item,
    label: '',
    description: item.label,
    iconPath: dimmed,
    alwaysShow: true
  };
}

/**
 * 运行单选模式。现有项使用原生过滤；允许创建时在顶部插入动态创建项。
 *
 * @param items - 可选项
 * @param options - 选择器配置
 * @param canAddItem - 是否允许根据输入创建新名称
 * @returns 选中项、创建结果或取消结果
 */
function runSinglePick<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options: PickerOptions<T> & { canSelectMany?: boolean; canAddItem?: boolean },
  canAddItem: boolean
): Promise<T | CreateOrPick<T> | undefined> {
  const quickPick = vscode.window.createQuickPick<T>();
  applyBaseOptions(quickPick, options);
  quickPick.canSelectMany = false;

  // 只有非空且未与现有标签重复的输入才生成创建项。
  const knownLabels = new Set(items.map((item) => item.label));
  let pendingCreate: { name: string; item: T } | undefined;

  /**
   * 将当前创建项和原始选项重新写入选择器。
   */
  const remount = (): void => {
    quickPick.items = pendingCreate ? [pendingCreate.item, ...items] : [...items];
  };

  if (canAddItem) {
    quickPick.onDidChangeValue((value) => {
      // 默认去除名称首尾空白，调用方可显式保留原始输入。
      const candidate = options.trimInput === false ? value : value.trim();
      if (candidate === '' || knownLabels.has(candidate)) {
        // 空名称或已有名称不显示创建项。
        pendingCreate = undefined;
      } else {
        // 创建项置于首位，使用户可直接按 Enter 确认。
        pendingCreate = {
          name: candidate,
          // 单选创建结果只返回名称，不会读取 `T` 的附加业务字段。
          item: buildCreateItem(candidate, options.createHint) as unknown as T,
        };
      }
      remount();
    });
  }
  remount();

  return new Promise<T | CreateOrPick<T> | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      // 允许创建时用判别联合区分新名称和现有项。
      if (canAddItem && pendingCreate !== undefined && selected === pendingCreate.item) {
        resolve({ kind: 'created', name: pendingCreate.name });
      } else if (selected !== undefined) {
        resolve(canAddItem ? { kind: 'picked', item: selected } : selected);
      }
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(undefined);
    });
    quickPick.show();
  });
}

/**
 * 运行多选模式。所有项保持可见，未匹配项显示为弱化副本；勾选状态始终关联原始项。
 * 提供 `buildCreatedItem` 时，用户可以连续创建并勾选新项。
 *
 * @param items - 初始可选项
 * @param options - 多选配置
 * @returns 选中的原始项；取消时为 `undefined`
 */
function runMultiPick<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options: PickerOptions<T> & { buildCreatedItem?: (name: string) => T }
): Promise<T[] | undefined> {
  const quickPick = vscode.window.createQuickPick<T>();
  applyBaseOptions(quickPick, options);
  quickPick.canSelectMany = true;

  // 新创建的项目会追加到这个列表，供后续搜索和选择。
  const knownItems = [...items];
  const knownLabels = new Set(knownItems.map((item) => item.label));
  // 以原始项对象保存选择状态，避免过滤时因替换可见项而丢失勾选。
  const checkedNames = new Set(options.checkedNames ?? []);
  const checked = new Set<T>(knownItems.filter((item) => checkedNames.has(item.label)));
  // 创建项会随输入重建，因此单独保存它的勾选状态。
  let createChecked = false;
  const buildCreatedItem = options.buildCreatedItem;
  // 输入为非空新名称时才存在待创建项。
  let pendingCreate: { name: string; item: T } | undefined;
  // 重设项目会触发选择事件；该标记用于忽略程序触发的同步。
  let remounting = false;
  // 将可见项（包括弱化副本）映射回原始项，确保结果不包含渲染副本。
  const rowSource = new Map<T, T>();

  /**
   * 根据搜索词重建可见项，并恢复勾选状态。创建项在最前，其后依次为匹配项和
   * 弱化的未匹配项；各组保持原有顺序。
   *
   * @param query - 已按配置处理的搜索文本
   */
  const render = (query: string): void => {
    const lowerQuery = query.toLowerCase();
    rowSource.clear();
    const matched: T[] = [];
    const unmatched: T[] = [];
    for (const item of knownItems) {
      if (lowerQuery === '' || item.label.toLowerCase().includes(lowerQuery)) {
        rowSource.set(item, item);
        matched.push(item);
      } else {
        const dimmed = dimItem(item);
        rowSource.set(dimmed, item);
        unmatched.push(dimmed);
      }
    }
    const visibleItems = [...matched, ...unmatched];
    remounting = true;
    quickPick.items = pendingCreate ? [pendingCreate.item, ...visibleItems] : visibleItems;
    // `createQuickPick` 需要通过 `selectedItems` 恢复选择；成员关系按原始项判断。
    const restore = visibleItems.filter((row) => {
      const source = rowSource.get(row);
      return source !== undefined && checked.has(source);
    });
    if (pendingCreate !== undefined && createChecked) {
      restore.push(pendingCreate.item);
    }
    quickPick.selectedItems = restore;
    remounting = false;
  };

  if (buildCreatedItem !== undefined) {
    quickPick.onDidChangeValue((value) => {
      // 默认去除名称首尾空白，调用方可显式保留原始输入。
      const candidate = options.trimInput === false ? value : value.trim();
      const nextCreate =
        candidate === '' || knownLabels.has(candidate)
          ? undefined
          : {
            name: candidate,
            // 临时创建项不会进入结果，业务字段由确认后的正式项目提供。
            item: buildCreateItem(candidate, options.createHint) as unknown as T,
          };
      // 创建项消失或首次出现时重置其勾选；连续编辑名称时保留勾选。
      if (nextCreate === undefined || pendingCreate === undefined) {
        createChecked = false;
      }
      pendingCreate = nextCreate;
      render(candidate);
    });
  }

  // 用户选择先映射回原始项，再同步到本地集合。
  quickPick.onDidChangeSelection((selected) => {
    if (remounting) {
      return;
    }
    // 所有项始终可见，因此当前选择可以完整替换旧集合。
    checked.clear();
    for (const row of selected) {
      const source = rowSource.get(row);
      if (source !== undefined) {
        checked.add(source);
      }
    }
    createChecked = pendingCreate !== undefined && selected.includes(pendingCreate.item);
  });

  // 显示前先设置项目，避免选择器初始为空。
  render('');

  return new Promise<T[] | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      // 勾选创建项后确认会添加正式项并继续；否则返回当前选择并关闭。
      if (pendingCreate !== undefined && createChecked && buildCreatedItem !== undefined) {
        const created = buildCreatedItem(pendingCreate.name);
        knownItems.push(created);
        knownLabels.add(created.label);
        checked.add(created);
        createChecked = false;
        pendingCreate = undefined;
        quickPick.value = '';
        // 显式重绘，不依赖设置 `value` 是否触发变化事件。
        render('');
        return;
      }
      resolve([...checked]);
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(undefined);
    });
    quickPick.show();
  });
}
