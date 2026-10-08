import { ConfigError } from './errors';
import { toFrozenJson, type JsonValue } from './json';
import type { LatencyRange } from './network';
import type { NodeStatus } from './node';
import type { MessageId, NodeId } from './protocol';
import type { VirtualTime } from './time';
import type { TraceEntry } from './trace';
import { isRecord } from './validation';

/**
 * Invariants: executable safety specifications, checked online after every committed step
 * (ADR-0012). Invariants are trusted, synchronous, deterministic code: no Math.random, Date,
 * I/O or module-level mutable state. Everything they can reach is deeply frozen.
 */

export type InvariantPolicy = 'stop-on-first' | 'record-and-continue';

/** How an invariant is identified in the trace. */
export interface InvariantRef {
  readonly id: string;
  readonly version: string;
  readonly name: string;
}

export interface NodeView {
  readonly id: NodeId;
  readonly status: NodeStatus;
  readonly incarnation: number;
  /** Volatile protocol state (deeply frozen), undefined before start and while crashed. */
  readonly state: JsonValue | undefined;
  /** Committed persistent storage, as a frozen object with sorted keys. Built on first access. */
  readonly storage: Readonly<Record<string, JsonValue>>;
  /** Trace index of the entry that produced `state` (its `state.update`), or null. */
  readonly stateEntry: number | null;
}

/** A message that has been sent and scheduled for delivery but not yet delivered or dropped. */
export interface InFlightMessage {
  readonly id: MessageId;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly payload: JsonValue;
  readonly sentAt: VirtualTime;
  readonly deliverAt: VirtualTime;
  /** Trace index of its `message.send` entry. */
  readonly sendIndex: number;
}

export interface NetworkView {
  /** Active partition groups (every node exactly once), or null. */
  readonly partition: readonly (readonly NodeId[])[] | null;
  /** Active directed link conditions, in the order they were set. */
  readonly links: readonly { readonly from: NodeId; readonly to: NodeId; readonly loss: number; readonly delay: LatencyRange }[];
}

/** Read-only, deeply frozen view of the whole simulation after a step. */
export interface SimulationView {
  readonly time: VirtualTime;
  /** Events dispatched so far, including the one that just ran. */
  readonly eventNumber: number;
  /** All nodes, in configuration order. */
  readonly nodes: readonly NodeView[];
  /** Look up one node; throws for an unknown id. */
  node(id: NodeId): NodeView;
  /** Messages in flight, in send order. */
  readonly inFlight: readonly InFlightMessage[];
  readonly network: NetworkView;
}

/** The step that was just committed. */
export interface StepInfo {
  /** The first entry of the step: the event that was dispatched. */
  readonly trigger: TraceEntry;
  /** Every entry the step appended, in order (includes `trigger`). */
  readonly entries: readonly TraceEntry[];
}

export interface InvariantInput<H extends JsonValue> {
  readonly view: SimulationView;
  readonly step: StepInfo;
  /** This invariant's own history, as returned by its previous check (deeply frozen). */
  readonly history: H;
}

/** What an invariant asserts about a failure. The engine adds the observed facts (ADR-0013). */
export interface ViolationReport {
  /** Nodes involved, to be highlighted. Must be configured node ids. */
  readonly nodes: readonly NodeId[];
  /** The condition that should hold, in plain language. */
  readonly expected: string;
  /** What was found instead, in plain language. */
  readonly observed: string;
  /** Structured, JSON evidence (e.g. the leaders and their epochs). */
  readonly evidence?: JsonValue;
  /** Earlier trace indices the invariant cites as evidence. */
  readonly references?: readonly number[];
}

export type InvariantVerdict<H extends JsonValue> =
  | { readonly ok: true; readonly history?: H }
  | { readonly ok: false; readonly history?: H; readonly violation: ViolationReport };

export interface Invariant<H extends JsonValue = JsonValue> {
  /** Stable machine id: lowercase letters, digits and dashes, e.g. "single-leader". */
  readonly id: string;
  /** Bump when the rule or the shape of its history changes. */
  readonly version: string;
  /** Human-readable name. */
  readonly name: string;
  /**
   * Initial history for historical invariants; `null` for pure state invariants. History is
   * explicit, JSON-serialisable state owned by the engine, so it can be snapshotted (CP3).
   */
  readonly initialHistory: H;
  check(input: InvariantInput<H>): InvariantVerdict<H>;
}

/** Helper for type inference: `defineInvariant({ ... })` infers H from `initialHistory`. */
export function defineInvariant<H extends JsonValue>(invariant: Invariant<H>): Invariant<H> {
  return invariant;
}

export const MAX_INVARIANTS = 64;
export const DEFAULT_MAX_VIOLATIONS = 100;
const INVARIANT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_TEXT_LENGTH = 500;

export interface ResolvedInvariant {
  readonly ref: InvariantRef;
  readonly initialHistory: JsonValue;
  readonly check: Invariant['check'];
}

/** Validate the configured invariants at the trust boundary. */
export function resolveInvariants(input: unknown): readonly ResolvedInvariant[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) throw new ConfigError('invariants', 'must be an array');
  if (input.length > MAX_INVARIANTS) throw new ConfigError('invariants', `must contain at most ${MAX_INVARIANTS} invariants`);
  const seen = new Set<string>();
  return Object.freeze(
    input.map((candidate: unknown, i): ResolvedInvariant => {
      const path = `invariants[${i}]`;
      if (!isRecord(candidate)) throw new ConfigError(path, 'must be an object');
      const { id, version, name, check } = candidate;
      if (typeof id !== 'string' || !INVARIANT_ID.test(id)) throw new ConfigError(`${path}.id`, 'must match [a-z0-9][a-z0-9-]{0,63}');
      if (seen.has(id)) throw new ConfigError(`${path}.id`, `duplicate invariant id "${id}"`);
      seen.add(id);
      for (const [key, value] of [['version', version], ['name', name]] as const) {
        if (typeof value !== 'string' || value === '') throw new ConfigError(`${path}.${key}`, 'must be a non-empty string');
      }
      if (typeof check !== 'function') throw new ConfigError(`${path}.check`, 'must be a function');
      if (!('initialHistory' in candidate)) throw new ConfigError(`${path}.initialHistory`, 'is required (use null for state invariants)');
      let initialHistory: JsonValue;
      try {
        initialHistory = toFrozenJson(candidate['initialHistory'], `${path}.initialHistory`);
      } catch (error) {
        throw new ConfigError(`${path}.initialHistory`, error instanceof Error ? error.message : 'must be JSON');
      }
      return Object.freeze({
        ref: Object.freeze({ id, version: version as string, name: name as string }),
        initialHistory,
        check: (check as Invariant['check']).bind(candidate),
      });
    }),
  );
}

/** One result of evaluating the invariants after a step, in configuration order. */
export type InvariantOutcome =
  | {
      readonly kind: 'violation';
      readonly invariant: InvariantRef;
      readonly violationId: string;
      readonly nodes: readonly NodeId[];
      readonly expected: string;
      readonly observed: string;
      readonly evidence: JsonValue;
      readonly references: readonly number[];
    }
  | { readonly kind: 'cleared'; readonly invariant: InvariantRef; readonly violationId: string }
  | { readonly kind: 'error'; readonly invariant: InvariantRef; readonly error: string };

/**
 * Runs the invariants and owns their execution state: per-invariant history and, under
 * `record-and-continue`, the open violation episode. That state is explicit so CP3 snapshots can
 * capture it. Evaluation never throws; checker failures become `error` outcomes.
 */
export class InvariantMonitor {
  readonly #invariants: readonly ResolvedInvariant[];
  readonly #policy: InvariantPolicy;
  readonly #history: JsonValue[];
  /** Open violation id per invariant (record-and-continue only), or null while it holds. */
  readonly #open: (string | null)[];
  #violations = 0;

  constructor(invariants: readonly ResolvedInvariant[], policy: InvariantPolicy) {
    this.#invariants = invariants;
    this.#policy = policy;
    this.#history = invariants.map((invariant) => invariant.initialHistory);
    this.#open = invariants.map(() => null);
  }

  /** Total violations recorded so far. */
  get violations(): number {
    return this.#violations;
  }

  history(id: string): JsonValue | undefined {
    const index = this.#invariants.findIndex((invariant) => invariant.ref.id === id);
    return index === -1 ? undefined : this.#history[index];
  }

  /**
   * Evaluate every invariant, in configuration order, against the view after one step.
   * `isNode` and `traceLength` validate node ids and cited trace indices.
   */
  evaluate(view: SimulationView, step: StepInfo, isNode: (id: unknown) => boolean, traceLength: number): InvariantOutcome[] {
    const outcomes: InvariantOutcome[] = [];
    this.#invariants.forEach((invariant, i) => {
      let verdict: { ok: boolean; history: JsonValue; report: Omit<Extract<InvariantOutcome, { kind: 'violation' }>, 'kind' | 'invariant' | 'violationId'> | null };
      try {
        const raw: unknown = invariant.check(Object.freeze({ view, step, history: this.#history[i] as JsonValue }));
        verdict = validateVerdict(raw, this.#history[i] as JsonValue, isNode, traceLength);
      } catch (error) {
        outcomes.push({ kind: 'error', invariant: invariant.ref, error: describe(error) });
        return;
      }
      this.#history[i] = verdict.history;

      const open = this.#open[i] ?? null;
      if (verdict.report !== null) {
        if (this.#policy === 'record-and-continue' && open !== null) return; // same episode continues
        const violationId = `v${++this.#violations}`;
        if (this.#policy === 'record-and-continue') this.#open[i] = violationId;
        outcomes.push({ kind: 'violation', invariant: invariant.ref, violationId, ...verdict.report });
      } else if (open !== null) {
        this.#open[i] = null;
        outcomes.push({ kind: 'cleared', invariant: invariant.ref, violationId: open });
      }
    });
    return outcomes;
  }
}

/** Validate a checker's return value. Throws (→ `error` outcome) on anything malformed. */
function validateVerdict(
  raw: unknown,
  previousHistory: JsonValue,
  isNode: (id: unknown) => boolean,
  traceLength: number,
): { ok: boolean; history: JsonValue; report: Omit<Extract<InvariantOutcome, { kind: 'violation' }>, 'kind' | 'invariant' | 'violationId'> | null } {
  if (!isRecord(raw) || typeof raw['ok'] !== 'boolean') throw new TypeError('verdict must be an object with a boolean `ok`');
  const history = raw['history'] === undefined ? previousHistory : toFrozenJson(raw['history'], 'history');
  if (raw['ok']) return { ok: true, history, report: null };

  const violation = raw['violation'];
  if (!isRecord(violation)) throw new TypeError('a failing verdict needs a `violation` report');
  const { nodes, expected, observed, evidence, references } = violation;
  if (!Array.isArray(nodes) || !nodes.every(isNode) || new Set(nodes).size !== nodes.length) {
    throw new TypeError('violation.nodes must be distinct, configured node ids');
  }
  for (const [key, text] of [['expected', expected], ['observed', observed]] as const) {
    if (typeof text !== 'string' || text === '' || text.length > MAX_TEXT_LENGTH) {
      throw new TypeError(`violation.${key} must be a string of 1–${MAX_TEXT_LENGTH} characters`);
    }
  }
  const refs = references ?? [];
  if (!Array.isArray(refs) || !refs.every((r) => Number.isSafeInteger(r) && r >= 0 && r < traceLength)) {
    throw new TypeError('violation.references must be indices of existing trace entries');
  }
  return {
    ok: false,
    history,
    report: {
      nodes: Object.freeze([...(nodes as NodeId[])]),
      expected: expected as string,
      observed: observed as string,
      evidence: toFrozenJson(evidence ?? null, 'violation.evidence'),
      references: Object.freeze([...(refs as number[])]),
    },
  };
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return `non-Error thrown: ${String(error)}`;
  } catch {
    return 'non-Error thrown';
  }
}
