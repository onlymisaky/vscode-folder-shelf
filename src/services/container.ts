/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 服务容器使用类构造器作为键保存实例。服务只在组合入口注册一次，其他模块通过
 * {@link inject} 获取实例；泛型签名负责约束构造器与实例类型。
 */
const registry = new Map<abstract new (...args: any[]) => unknown, unknown>();

/**
 * 以类构造器为键注册服务实例。重复注册同一构造器时抛出异常。
 *
 * @template T - 服务实例类型，由 ctor 的实例类型推断
 * @param ctor - 服务构造器，可为抽象类
 * @param instance - 与构造器实例类型一致的服务实例
 */
export function provide<T>(ctor: abstract new (...args: any[]) => T, instance: T): void {
  if (registry.has(ctor)) throw new Error(`service already provided: ${ctor.name}`);
  registry.set(ctor, instance);
}

/**
 * 按类构造器获取已注册的服务实例。
 *
 * @template T - 期望的服务实例类型，由 ctor 的实例类型推断
 * @param ctor - 用于查询服务的构造器
 * @returns 已注册的服务实例
 * @throws 该构造器尚未经 {@link provide} 注册时抛出（通常是调用早于组合根初始化）
 */
export function inject<T>(ctor: abstract new (...args: any[]) => T): T {
  const instance = registry.get(ctor);
  if (instance === undefined) throw new Error(`service not provided: ${ctor.name}`);
  return instance as T;
}
