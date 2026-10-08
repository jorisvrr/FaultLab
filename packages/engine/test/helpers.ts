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
