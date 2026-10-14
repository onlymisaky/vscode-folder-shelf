import * as vscode from 'vscode';

/** 未命中行的弱化图标色：与 description 灰字同色，弱化观感统一 */
const DIMMED_ICON_COLOR = new vscode.ThemeColor('descriptionForeground');

/** 创建行动作图标 */
const CREATE_ICON = 'plus';

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
 * configure 回调可见的选择器视图：Omit 掉引擎托管属性，类型层读写均不通过检查；
 * 运行时由 guardPicker 的 Proxy 拦截写入，两道防线共用 MANAGED_KEYS 单一来源。
 */
type ConfigurablePicker<T extends vscode.QuickPickItem> = Omit<
  vscode.QuickPick<T>,
  (typeof MANAGED_KEYS)[number]
>;

/** 逃生舱：show 前回调，用于挂事件监听（onDidTriggerButton 等）或设置白名单外属性。 */
type ConfigurePickerOptions<T extends vscode.QuickPickItem> = {
  readonly configure?: (picker: ConfigurablePicker<T>) => void;
};

/**
 * showPicker 的配置项。分三层：
 * 语义参数（本封装的能力层）、原生属性白名单（1:1 转发）、configure 逃生舱（事件与长尾属性）。
 */
export interface PickerOptions<T extends vscode.QuickPickItem>
  extends NativePickerOptions<T>,
    ConfigurePickerOptions<T> {
  // —— 语义参数（本封装的能力层）——
  /** 输入框标题；必须由调用方提前完成本地化 */
  readonly title: string;
  /** 占位提示；必须由调用方提前完成本地化 */
  readonly placeholder?: string;
  /** 创建行的灰字说明（如「创建标签」）；必须由调用方提前完成本地化 */
  readonly createHint?: string;
  /**
   * 输入值是否先去首尾空白再参与创建判定与命名；默认 true。
   * 置 false 时输入原样参与：纯空白输入也会触发创建行，created 名字与传给
   * buildCreatedItem 的名字均保留原文空白。
   * 仅创建形态（canAddItem: true）有输入处理，其余形态不消费该参数。
   */
  readonly trimInput?: boolean;
  /**
   * 多选 + canAddItem 时必传（overload 层强制）：把确认创建的名字构造成正式行
   * （label 须等于 name，否则后续按输入词过滤时该行会失配）。
   */
  readonly buildCreatedItem?: (name: string) => T;
  /**
   * 多选模式的默认勾选：元素为行名，打开时将 label 与之精确相等的行勾选上，用于回显既有选择。
   * 仅打开时生效一次，此后勾选态由内部维护；items 中没有对应行的名字会被忽略。
   */
  readonly checkedNames?: readonly string[];
}

/**
 * 单选 + canAddItem 的结果：命中现有行（picked）/ 输入了不存在的名字并确认创建（created）。
 */
export type CreateOrPick<T extends vscode.QuickPickItem> =
  | {
      /** 命中了列表中的现有行 */
      readonly kind: 'picked';
      /** 被选中的行对象（可能是动作项，由调用方按对象同一性识别） */
      readonly item: T;
    }
  | {
      /** 输入了不存在的名字并确认创建 */
      readonly kind: 'created';
      /** 创建名：trimInput 为默认 true 时已去首尾空白，否则为输入原文 */
      readonly name: string;
    };

/**
 * 统一选择器入口：基于 createQuickPick 的单引擎封装，按 canSelectMany / canAddItem
 * 的组合覆盖四种形态（返回类型经 overloads 精确收窄）：
 *
 * | canSelectMany | canAddItem | 返回类型 |
 * |---|---|---|
 * | false | false | `T \| undefined` |
 * | false | true  | `CreateOrPick<T> \| undefined` |
 * | true  | false | `T[] \| undefined` |
 * | true  | true  | `T[] \| undefined`（buildCreatedItem 必传，创建经它并入结果） |
 *
 * 交互规则：
 * - 输入经 trimInput（默认 true，去首尾空白）归一后非空且不与任何已知行 label 相等 →
 *   最上方出现创建行（label=归一后的输入词 + plus 图标 + 灰字 createHint，精确匹配得分恒最高
 *   从而被内置过滤钉在首位）；否则创建行消失
 * - 单选模式：静态行走原生过滤；回车命中创建行 → 立即返回 created 并关闭；命中现有行 → picked；
 *   无选中回车 / Esc → undefined
 * - 多选模式：全部行 alwaysShow——未命中行降级为灰显（label 置空、名字挪入 description、图标弱化），
 *   勾选态以本地 Set（持有源行对象）为唯一状态源，重挂后经 rowSource（可见行 → 源行对象）
 *   以源对象成员资格恢复，不因过滤丢失、灰显副本不会混入结果；回车时若创建行被勾选 →
 *   新行入列并勾选、输入框清空、对话框保持打开；否则返回当前勾选全集并关闭；创建行不入结果集
 * - accept/hide 均只 resolve 一次；hide 后 dispose
 *
 * 目标形态是「打开即确定、结果确定、Esc 可取消」的输入对话框；常驻型/流式 picker
 * （异步加载、动态 enabled/busy）不在封装范围内，请直接使用原生 createQuickPick。
 *
 * @param items - 行全集（T 须携带业务标识字段，结果按行对象回传；label 即名字域）
 * @param options - 配置项；canSelectMany / canAddItem 必须以字面量内联传入（放宽为 boolean 无法匹配 overload）
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
 * 运行时守卫：把真实 QuickPick 包成 Proxy，对引擎托管属性的写入直接抛错——
 * 类型层 Omit 可被断言绕过，此处兜底防止误写破坏引擎状态。
 */
function guardPicker<T extends vscode.QuickPickItem>(picker: vscode.QuickPick<T>): ConfigurablePicker<T> {
  return new Proxy(picker, {
    get(target, prop): unknown {
      const value: unknown = Reflect.get(target, prop, target);
      // 方法绑定 target：避免以 proxy 为 this 时内部写入误触拦截
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, prop, newValue): boolean {
      if (typeof prop === 'string' && (MANAGED_KEYS as readonly string[]).includes(prop)) {
        throw new Error(`showPicker: configure cannot set managed property "${prop}"`);
      }
      return Reflect.set(target, prop, newValue, target);
    },
  });
}

/** 转发白名单属性并执行 configure（引擎托管属性随后由各流程自行设置）。 */
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

/** 统一创建行：label 必须精确等于输入词（内置过滤按模糊得分重排，精确匹配得分恒最高）。 */
function buildCreateItem(name: string, hint?: string): vscode.QuickPickItem {
  return {
    label: name,
    description: hint,
    iconPath: new vscode.ThemeIcon(CREATE_ICON),
    alwaysShow: true,
  };
}

/** 未命中行的灰显降级：label 置空、名字挪入 description、ThemeIcon 克隆弱化（Uri 透传）。 */
function dimItem<T extends vscode.QuickPickItem>(item: T): T {
  const icon = item.iconPath;
  const dimmed = icon instanceof vscode.ThemeIcon ? new vscode.ThemeIcon(icon.id, DIMMED_ICON_COLOR) : icon;
  // 展开保留 T 的业务字段，其余字段降级
  return { ...item, label: '', description: item.label, iconPath: dimmed, alwaysShow: true };
}

/**
 * 单选模式：静态行走原生过滤；canAddItem 时动态插入创建行，回车命中即返回 created 并关闭。
 * canAddItem 为 false 时退化为 showQuickPick 常用形态（直接返回命中的行对象）。
 */
function runSinglePick<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options: PickerOptions<T> & { canSelectMany?: boolean; canAddItem?: boolean },
  canAddItem: boolean
): Promise<T | CreateOrPick<T> | undefined> {
  const quickPick = vscode.window.createQuickPick<T>();
  applyBaseOptions(quickPick, options);
  quickPick.canSelectMany = false;

  // 输入值按 trimInput 归一（默认去首尾空白）后非空且不与任何已知行 label 相等 → 动态插入创建行（label 含输入值才能在内置过滤中存活）
  const knownLabels = new Set(items.map((item) => item.label));
  let pendingCreate: { name: string; item: T } | undefined;

  const remount = (): void => {
    quickPick.items = pendingCreate ? [pendingCreate.item, ...items] : [...items];
  };

  if (canAddItem) {
    quickPick.onDidChangeValue((value) => {
      // 输入按 trimInput 归一（默认去首尾空白），归一后非空才可能触发创建行
      const candidate = options.trimInput === false ? value : value.trim();
      if (candidate === '' || knownLabels.has(candidate)) {
        // 归一后为空或命中现有行 label → 无创建行
        pendingCreate = undefined;
      } else {
        // 输入新名 → 创建行置顶（重挂后活动行落在新 items 首行，回车即命中创建行）
        pendingCreate = {
          name: candidate,
          // 创建行的 T 特有业务字段运行时为 undefined，结果只经 name 回传，一次断言完成构造
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
      // 命中动态创建行 → 返回 created；命中静态行 → 返回 picked（或静态形态直接返回行对象）；无选中则仅关闭
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
 * 多选模式：全部行 alwaysShow（扩展 API 已无法关闭内置过滤），未命中行灰显降级而非隐藏，
 * 勾选态以本地 Set 为唯一状态源，重挂后经 rowSource 以「源对象成员资格」恢复并以
 * remounting 守卫屏蔽回环；buildCreatedItem 存在时支持「创建并继续」——新行即时入列并勾选，
 * 对话框保持打开。
 */
function runMultiPick<T extends vscode.QuickPickItem>(
  items: readonly T[],
  options: PickerOptions<T> & { buildCreatedItem?: (name: string) => T }
): Promise<T[] | undefined> {
  const quickPick = vscode.window.createQuickPick<T>();
  applyBaseOptions(quickPick, options);
  quickPick.canSelectMany = true;

  // 可增长的行全集：连续创建的新行即时入列（初始为打开时的全部条目）
  const knownItems = [...items];
  const knownLabels = new Set(knownItems.map((item) => item.label));
  // 勾选状态外置：Set 为唯一状态源，持有源行对象；checkedNames 以名字域传入，打开时按 label 相等解析
  const checkedNames = new Set(options.checkedNames ?? []);
  const checked = new Set<T>(knownItems.filter((item) => checkedNames.has(item.label)));
  // 创建行勾选态单独跟踪（每次键入重建创建行对象）
  let createChecked = false;
  const buildCreatedItem = options.buildCreatedItem;
  // 待创建行：canAddItem 且键入按 trimInput 归一（默认去首尾空白）后非空且不是已知行名时存在
  let pendingCreate: { name: string; item: T } | undefined;
  // 正在重挂 items：重挂引发的选中事件与本地状态一致，忽略以免回环
  let remounting = false;
  // 可见行 → 源行对象：命中行映射到自身，灰显副本映射到源行；创建行不入映射。
  // 灰显副本是每次渲染新建的 {...item}，与源对象身份不同——勾选同步与恢复必须经此映射
  // 还原到源对象，否则勾选态在副本与源之间漂移、副本可能混入结果集
  const rowSource = new Map<T, T>();

  /**
   * 根据查询词重建行序与 rowSource，并恢复由本地集合维护的勾选状态。
   * 创建行在前，其后依次为命中行和灰显的未命中行；组内保持原有顺序。
   * 命中片段由运行时自动高亮。
   *
   * @param query - 当前搜索文本；调用前已按 trimInput 归一（默认去除首尾空白）
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
    // 勾选态恢复：按源对象判定成员资格，勾选挂回可见行本体（命中行或灰显副本——
    // 未命中已勾选行的勾选态不因灰显降级而丢失）；
    // item.picked 仅 showQuickPick 生效，createQuickPick 必须经 selectedItems 设置；
    // 处于 remounting 守卫内，本次程序化设置不会触发状态同步
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
      // 输入按 trimInput 归一（默认去首尾空白）
      const candidate = options.trimInput === false ? value : value.trim();
      const nextCreate =
        candidate === '' || knownLabels.has(candidate)
          ? undefined
          : {
              name: candidate,
              // 创建行的 T 特有业务字段运行时为 undefined，结果不含创建行，一次断言完成构造
              item: buildCreateItem(candidate, options.createHint) as unknown as T,
            };
      // 创建行从有到无时重置勾选态；持续键入（有到有）则保留，用户可边输入边勾选
      if (nextCreate === undefined || pendingCreate === undefined) {
        createChecked = false;
      }
      pendingCreate = nextCreate;
      render(candidate);
    });
  }

  // 用户勾选/取消 → 经 rowSource 还原为源行对象后同步进本地状态
  // （创建行不在映射中天然排除；灰显副本还原到源，不产生重复身份）
  quickPick.onDidChangeSelection((selected) => {
    if (remounting) {
      return;
    }
    // 恒等替换：勾选全集即本次选中集（全部行恒可见，无需与旧集合做差集）
    checked.clear();
    for (const row of selected) {
      const source = rowSource.get(row);
      if (source !== undefined) {
        checked.add(source);
      }
    }
    createChecked = pendingCreate !== undefined && selected.includes(pendingCreate.item);
  });

  // 首次渲染：show 前必须先挂 items，否则列表为空直到键入触发 onDidChangeValue
  render('');

  return new Promise<T[] | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      // 勾选创建行回车 = 创建并继续：新行即时入列并勾选、输入框清空、对话框保持打开；
      // 未勾选创建行（或无创建行）回车 = 确认收尾，一次性返回结果
      // buildCreatedItem 判空仅为跨闭包收窄：pendingCreate 只能在它存在时被置位
      if (pendingCreate !== undefined && createChecked && buildCreatedItem !== undefined) {
        const created = buildCreatedItem(pendingCreate.name);
        knownItems.push(created);
        knownLabels.add(created.label);
        checked.add(created);
        createChecked = false;
        pendingCreate = undefined;
        quickPick.value = '';
        // 不依赖 value 赋值是否回触发 onDidChangeValue，显式重渲染
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
