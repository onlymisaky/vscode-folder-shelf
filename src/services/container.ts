/* eslint-disable @typescript-eslint/no-explicit-any */
const registry = new Map<abstract new (...args: any[]) => unknown, unknown>();

export function provide<T>(ctor: abstract new (...args: any[]) => T, instance: T): void {
  if (registry.has(ctor)) throw new Error(`service already provided: ${ctor.name}`);
  registry.set(ctor, instance);
}

export function inject<T>(ctor: abstract new (...args: any[]) => T): T {
  const instance = registry.get(ctor);
  if (instance === undefined) throw new Error(`service not provided: ${ctor.name}`);
  return instance as T;
}
