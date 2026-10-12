/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 极简服务容器：以「类构造器 → 实例」映射实现服务注册与按类获取。
 * 仅扩展组合根（services/index.ts 的 registerServices）注册一次，其余模块经 inject 按类取实例，
 * 使命令 / 树视图等代码依赖类型而非具体构造细节。
 * registry 的值类型为 unknown，实例的类型安全由 provide / inject 的泛型签名保证。
 */
const registry = new Map<abstract new (...args: any[]) => unknown, unknown>();

/**
 * 注册服务实例（以类构造器为唯一键）。同一构造器重复注册视为编程错误，直接抛异常以免实例被静默覆盖。
 *
 * @template T - 服务实例类型，由 ctor 的实例类型推断
 * @param ctor - 服务的类构造器（含抽象类），作为实例的唯一标识键
 * @param instance - 要注册的服务实例，类型须与 ctor 的实例类型一致
 */
export function provide<T>(ctor: abstract new (...args: any[]) => T, instance: T): void {
  if (registry.has(ctor)) throw new Error(`service already provided: ${ctor.name}`);
  registry.set(ctor, instance);
}

/**
 * 按类构造器获取已注册的服务实例。
 *
 * @template T - 期望的服务实例类型，由 ctor 的实例类型推断
 * @param ctor - 服务的类构造器，用于查找注册表
 * @returns 已注册的实例（类型为 T）
 * @throws 该构造器尚未经 {@link provide} 注册时抛出（通常是调用早于组合根初始化）
 */
export function inject<T>(ctor: abstract new (...args: any[]) => T): T {
  const instance = registry.get(ctor);
  if (instance === undefined) throw new Error(`service not provided: ${ctor.name}`);
  return instance as T;
}
