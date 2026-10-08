import type { SimulationConfig } from '../src/config';
import type { JsonValue } from '../src/json';
import type { FiredTimer, IncomingMessage, NodeContext, Protocol } from '../src/protocol';
import type { TraceEntry } from '../src/trace';

export const THREE_NODES = ['n1', 'n2', 'n3'] as const;

/** Build a config, erasing protocol generics (configs are heterogeneous in tests). */
export function config(
  protocol: Protocol<never, never> | Protocol,
  overrides: Partial<Omit<SimulationConfig, 'protocol'>> = {},
): SimulationConfig {
  return {
    seed: 42,
    nodes: [...THREE_NODES],
    network: { latency: { min: 5, max: 5 } },
    ...overrides,
    protocol: protocol as unknown as Protocol,
  };
}

export interface TestHandlers {
  init(ctx: NodeContext<JsonValue>): JsonValue;
  onMessage?(state: JsonValue, message: IncomingMessage<JsonValue>, ctx: NodeContext<JsonValue>): JsonValue;
  onTimer?(state: JsonValue, timer: FiredTimer, ctx: NodeContext<JsonValue>): JsonValue;
}

/** A loosely typed protocol assembled from handlers; omitted handlers keep state unchanged. */
export function protocol(handlers: TestHandlers): Protocol {
  return {
    name: 'test',
    version: '1',
    onMessage: (state: JsonValue) => state,
    onTimer: (state: JsonValue) => state,
    ...handlers,
  };
}

export function ofKind<K extends TraceEntry['kind']>(trace: readonly TraceEntry[], kind: K): Extract<TraceEntry, { kind: K }>[] {
  return trace.filter((entry): entry is Extract<TraceEntry, { kind: K }> => entry.kind === kind);
}

/**
 * Walk everything reachable from `root` (calling getters) and report anything that is not
 * frozen or is not plain data/functions. Used to prove runtime immutability, not just `readonly`.
 */
export function mutabilityProblems(root: unknown): string[] {
  const problems: string[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown, path: string): void => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null || seen.has(value)) return;
    seen.add(value);
    if (!Object.isFrozen(value)) problems.push(`${path} is not frozen`);
    const proto: unknown = Object.getPrototypeOf(value);
    if (![Object.prototype, Array.prototype, Function.prototype, null].includes(proto as object | null)) {
      problems.push(`${path} is a ${(value as { constructor?: { name?: string } }).constructor?.name ?? 'non-plain object'}`);
    }
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (typeof value === 'function' && ['length', 'name', 'prototype'].includes(key)) continue;
      visit('value' in descriptor ? descriptor.value : descriptor.get?.call(value), `${path}.${key}`);
    }
  };
  visit(root, '$');
  return problems;
}
