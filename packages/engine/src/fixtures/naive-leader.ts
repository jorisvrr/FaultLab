import { defineInvariant, type Invariant, type NodeView } from '../invariants';
import type { NodeId, Protocol } from '../protocol';

export type NaiveLeaderMessage = { readonly type: 'heartbeat'; readonly epoch: number; readonly leader: boolean };

export type NaiveLeaderState = {
  readonly role: 'follower' | 'leader';
  /** Highest epoch this node has seen. Mirrored in persistent storage (see below). */
  readonly epoch: number;
  /** The epoch in which this node became leader, or null while follower. */
  readonly leaderEpoch: number | null;
  /** When this incarnation booted; no claim is allowed before bootAt + timeout. */
  readonly bootAt: number;
  /** Virtual time each peer was last heard from. */
  readonly lastHeard: { readonly [peer: string]: number };
};

export interface NaiveLeaderOptions {
  /** Ticks between heartbeats. */
  readonly interval?: number;
  /** Extra random ticks (0..jitter) per interval, from the node's own stream. */
  readonly jitter?: number;
  /** A peer counts as alive if heard from within this many ticks. Must exceed interval + jitter + max latency. */
  readonly timeout?: number;
}

/**
 * DELIBERATELY UNSAFE leader election, used to demonstrate split brain (CP2).
 *
 * Rule: a node leads iff it has been up for `timeout` ticks and has not heard from any
 * higher-ranked node (string order of ids) within `timeout`. A leader steps down as soon as it
 * hears a higher-ranked node. Leaders take epoch = (highest epoch seen) + 1.
 *
 * Why it is correct on a healthy network (no partitions, no loss, latency below
 * `timeout − interval − jitter`), even with crashes: every node hears every running higher node
 * well within `timeout`, so only the highest running node ever claims, and the startup delay
 * means nobody claims before it has heard everyone. Initial convergence is therefore NOT a
 * window with several leaders.
 *
 * The highest epoch seen is PERSISTED (`ctx.storage`, like Raft's currentTerm). An earlier draft
 * kept it volatile; the crash/recover property test found that when every node crashed, nobody
 * remembered the old epoch and a later leader reused it (see ENGINEERLOG, CP2).
 *
 * Why it is unsafe: liveness of a peer is inferred from silence. A partition (or heavy loss)
 * makes a live higher node look dead, so both sides elect a leader. Nothing like a majority
 * quorum prevents it. Raft (CP4) fixes exactly this.
 */
export function createNaiveLeaderProtocol(options: NaiveLeaderOptions = {}): Protocol<NaiveLeaderState, NaiveLeaderMessage> {
  const { interval = 20, jitter = 5, timeout = 60 } = options;
  const nextTick = (random: { nextInt(min: number, max: number): number }): number => interval + (jitter > 0 ? random.nextInt(0, jitter) : 0);

  return {
    name: 'naive-leader',
    version: '1',
    init(ctx) {
      ctx.setTimer(nextTick(ctx.random), 'tick');
      const epoch = (ctx.storage.get('epoch') as number | undefined) ?? 0;
      return { role: 'follower', epoch, leaderEpoch: null, bootAt: ctx.now, lastHeard: {} };
    },
    onMessage(state, message, ctx) {
      const { from, payload } = message;
      const higherSpoke = from > ctx.self;
      if (payload.epoch > state.epoch) ctx.storage.set('epoch', payload.epoch);
      return {
        ...state,
        epoch: Math.max(state.epoch, payload.epoch),
        lastHeard: { ...state.lastHeard, [from]: ctx.now },
        ...(higherSpoke && state.role === 'leader' ? { role: 'follower', leaderEpoch: null } : {}),
      };
    },
    onTimer(state, _timer, ctx) {
      ctx.setTimer(nextTick(ctx.random), 'tick');
      let next = state;
      const higherAlive = ctx.peers.some((p) => p > ctx.self && state.lastHeard[p] !== undefined && ctx.now - state.lastHeard[p] < timeout);
      if (state.role === 'follower' && ctx.now - state.bootAt >= timeout && !higherAlive) {
        const epoch = state.epoch + 1;
        ctx.storage.set('epoch', epoch); // durable before the heartbeat announcing it leaves
        next = { ...state, role: 'leader', epoch, leaderEpoch: epoch };
      }
      ctx.broadcast({ type: 'heartbeat', epoch: next.epoch, leader: next.role === 'leader' });
      return next;
    },
  };
}

const leaderState = (node: NodeView): NaiveLeaderState | null => {
  const state = node.state as NaiveLeaderState | undefined;
  return node.status === 'running' && state?.role === 'leader' ? state : null;
};
const leadersOf = (nodes: readonly NodeView[]) =>
  nodes.flatMap((node) => {
    const state = leaderState(node);
    return state === null ? [] : [{ node, state }];
  });

/** STATE invariant: at any moment, at most one running node is leader. */
export const singleLeader = defineInvariant({
  id: 'single-leader',
  version: '1',
  name: 'At most one leader at a time',
  initialHistory: null,
  check: ({ view }) => {
    const leaders = leadersOf(view.nodes);
    if (leaders.length <= 1) return { ok: true };
    return {
      ok: false,
      violation: {
        nodes: leaders.map(({ node }) => node.id),
        expected: 'At most one running node is leader',
        observed: `${leaders.length} running nodes are leader: ${leaders.map(({ node }) => node.id).join(', ')}`,
        evidence: { leaders: leaders.map(({ node, state }) => ({ node: node.id, incarnation: node.incarnation, leaderEpoch: state.leaderEpoch })) },
        references: leaders.flatMap(({ node }) => (node.stateEntry === null ? [] : [node.stateEntry])),
      },
    };
  },
});

type EpochHistory = { readonly [epoch: string]: { readonly node: NodeId; readonly entry: number | null } };

/**
 * HISTORICAL invariant (Raft's Election Safety, in naive form): over the whole run, each epoch
 * has at most one leader. Two leaders of the same epoch at DIFFERENT times also violate it,
 * which a state invariant cannot see. History: the first leader seen for each epoch.
 */
export const uniqueLeaderPerEpoch = defineInvariant({
  id: 'unique-leader-per-epoch',
  version: '1',
  name: 'At most one leader per epoch, ever',
  initialHistory: {} as EpochHistory,
  check: ({ view, history }) => {
    let next = history;
    for (const { node, state } of leadersOf(view.nodes)) {
      const key = String(state.leaderEpoch);
      const first = next[key];
      if (first === undefined) {
        next = { ...next, [key]: { node: node.id, entry: node.stateEntry } };
      } else if (first.node !== node.id) {
        return {
          ok: false,
          history: next,
          violation: {
            nodes: [first.node, node.id],
            expected: `Epoch ${key} has a single leader for the whole run`,
            observed: `Epoch ${key} was led by ${first.node} and later also by ${node.id}`,
            evidence: { epoch: state.leaderEpoch, first: first.node, second: node.id },
            references: [first.entry, node.stateEntry].filter((i): i is number => i !== null),
          },
        };
      }
    }
    return { ok: true, history: next };
  },
});

type EpochTrack = { readonly [node: string]: { readonly incarnation: number; readonly epoch: number } };

/** HISTORICAL invariant: within one incarnation, a node's epoch never decreases. */
export const epochMonotonic = defineInvariant({
  id: 'epoch-monotonic',
  version: '1',
  name: 'Epochs never go backwards within an incarnation',
  initialHistory: {} as EpochTrack,
  check: ({ view, history }) => {
    const next: Record<string, { incarnation: number; epoch: number }> = { ...history };
    for (const node of view.nodes) {
      const state = node.state as NaiveLeaderState | undefined;
      if (node.status !== 'running' || state === undefined) continue;
      const seen = history[node.id];
      if (seen !== undefined && seen.incarnation === node.incarnation && state.epoch < seen.epoch) {
        return {
          ok: false,
          violation: {
            nodes: [node.id],
            expected: `${node.id}'s epoch never decreases within incarnation ${node.incarnation}`,
            observed: `epoch went from ${seen.epoch} to ${state.epoch}`,
            evidence: { before: seen.epoch, after: state.epoch, incarnation: node.incarnation },
          },
        };
      }
      next[node.id] = { incarnation: node.incarnation, epoch: state.epoch };
    }
    return { ok: true, history: next };
  },
});

/** STATE invariant: a leader holds a positive leader epoch no greater than the highest it has seen. */
export const leaderEpochConsistent = defineInvariant({
  id: 'leader-epoch-consistent',
  version: '1',
  name: 'Leaders carry a consistent epoch',
  initialHistory: null,
  check: ({ view }) => {
    for (const { node, state } of leadersOf(view.nodes)) {
      if (state.leaderEpoch === null || state.leaderEpoch < 1 || state.leaderEpoch > state.epoch) {
        return {
          ok: false,
          violation: {
            nodes: [node.id],
            expected: 'leader ⇒ 1 ≤ leaderEpoch ≤ epoch',
            observed: `leaderEpoch ${String(state.leaderEpoch)}, epoch ${state.epoch}`,
          },
        };
      }
    }
    return { ok: true };
  },
});

/** Protocol-agnostic STATE invariant: no in-flight message is overdue (engine sanity check). */
export const noOverdueMessages = defineInvariant({
  id: 'no-overdue-messages',
  version: '1',
  name: 'No in-flight message is overdue',
  initialHistory: null,
  check: ({ view }) => {
    const overdue = view.inFlight.filter((m) => m.deliverAt < view.time);
    if (overdue.length === 0) return { ok: true };
    return {
      ok: false,
      violation: {
        nodes: [...new Set(overdue.flatMap((m) => [m.from, m.to]))],
        expected: 'every in-flight message is due now or later',
        observed: `${overdue.length} overdue message(s)`,
        evidence: { messages: overdue.map((m) => m.id) },
        references: overdue.map((m) => m.sendIndex),
      },
    };
  },
});

/** The five invariants used by the CP2 tests and benchmark, in evaluation order. */
export const naiveLeaderInvariants: readonly Invariant[] = Object.freeze([
  singleLeader,
  uniqueLeaderPerEpoch,
  epochMonotonic,
  leaderEpochConsistent,
  noOverdueMessages,
] as Invariant[]);
