import type { JsonValue } from '../src/json';
import type { NodeId } from '../src/protocol';
import type { MessageSendEntry, TraceEntry } from '../src/trace';

/**
 * An independent, trace-only oracle for the CP1 lifecycle and network semantics.
 *
 * It re-derives every node's lifecycle, every timer and every message purely from trace entries
 * and reports each rule that the trace violates. Because it shares no code with the engine, a
 * bug would have to be made twice, in the same way, to slip through. This is the seed of the
 * CP2 invariant checker.
 */
export function checkTraceInvariants(trace: readonly TraceEntry[]): string[] {
  const violations: string[] = [];
  const fail = (entry: TraceEntry, rule: string): void => {
    violations.push(`#${entry.index} ${entry.kind} @${entry.time}: ${rule}`);
  };

  const start = trace[0];
  if (start?.kind !== 'run.start') return ['trace does not begin with run.start'];

  const nodes = new Map<NodeId, { status: 'idle' | 'running' | 'crashed'; incarnation: number; storage: Map<string, JsonValue> }>();
  for (const id of start.nodes) nodes.set(id, { status: 'idle', incarnation: 0, storage: new Map() });
  const timers = new Map<string, { node: NodeId; incarnation: number; pending: boolean; fireAt: number }>();
  const messages = new Map<string, { send: MessageSendEntry; resolved: boolean }>();
  const appliedFaults = new Set<string>();
  let groupOf: Map<NodeId, number> | null = null;
  const separated = (a: NodeId, b: NodeId): boolean => groupOf !== null && groupOf.get(a) !== groupOf.get(b);

  for (const entry of trace) {
    if (entry.index > 0 && entry.kind !== 'run.end' && (entry.cause === null || entry.cause >= entry.index)) {
      fail(entry, 'cause must point to an earlier entry');
    }
    if ('faultId' in entry) {
      if (entry.cause !== 0) fail(entry, 'fault entries are caused by run.start');
      if (appliedFaults.has(entry.faultId)) fail(entry, `fault ${entry.faultId} handled twice`);
      appliedFaults.add(entry.faultId);
    }

    // Every entry produced by a node's own step requires that node to be running in that incarnation.
    switch (entry.kind) {
      case 'message.send':
      case 'message.deliver':
      case 'timer.set':
      case 'timer.fire':
      case 'timer.cancel':
      case 'state.update':
      case 'storage.write':
      case 'protocol.error': {
        const node = nodes.get(entry.node);
        if (node?.status !== 'running') fail(entry, `${entry.node} is ${node?.status ?? 'unknown'}, not running`);
        else if (node.incarnation !== entry.incarnation) {
          fail(entry, `incarnation ${entry.incarnation} but ${entry.node} is in incarnation ${node.incarnation}`);
        }
      }
    }

    switch (entry.kind) {
      case 'node.start': {
        const node = nodes.get(entry.node);
        if (node?.status !== 'idle') fail(entry, 'node started twice');
        else Object.assign(node, { status: 'running', incarnation: 1 });
        if (entry.incarnation !== 1) fail(entry, 'first incarnation must be 1');
        break;
      }
      case 'node.crash': {
        const node = nodes.get(entry.node);
        if (node?.status !== 'running') {
          fail(entry, 'crashed a node that was not running');
          break;
        }
        if (entry.incarnation !== node.incarnation) fail(entry, 'crash reports the wrong incarnation');
        const pending = [...timers].filter(([, t]) => t.node === entry.node && t.pending).map(([id]) => id);
        if ([...pending].sort().join() !== [...entry.cancelledTimers].sort().join()) {
          fail(entry, `cancelledTimers ${entry.cancelledTimers.join()} != pending ${pending.join()}`);
        }
        for (const id of pending) (timers.get(id) as { pending: boolean }).pending = false;
        node.status = 'crashed';
        break;
      }
      case 'node.recover': {
        const node = nodes.get(entry.node);
        if (node?.status !== 'crashed') {
          fail(entry, 'recovered a node that was not crashed');
          break;
        }
        if (entry.incarnation !== node.incarnation + 1) fail(entry, 'recovery must increment the incarnation by exactly 1');
        Object.assign(node, { status: 'running', incarnation: entry.incarnation });
        break;
      }
      case 'fault.skipped': {
        const node = nodes.get(entry.node);
        const expected = entry.faultType === 'crash' ? 'crashed' : 'running';
        if (node?.status !== expected) fail(entry, `skipped ${entry.faultType} while ${entry.node} was ${node?.status}`);
        break;
      }
      case 'network.partition':
        groupOf = new Map();
        entry.groups.forEach((group, g) => group.forEach((id) => (groupOf as Map<NodeId, number>).set(id, g)));
        if (groupOf.size !== start.nodes.length) fail(entry, 'partition groups must cover every node');
        break;
      case 'network.heal':
        groupOf = null;
        break;
      case 'timer.set':
        timers.set(entry.timerId, { node: entry.node, incarnation: entry.incarnation, pending: true, fireAt: entry.fireAt });
        break;
      case 'timer.cancel': {
        const timer = timers.get(entry.timerId);
        if (timer?.pending !== true) fail(entry, 'cancelled a timer that was not pending');
        else timer.pending = false;
        break;
      }
      case 'timer.fire': {
        const timer = timers.get(entry.timerId);
        if (timer === undefined || !timer.pending) fail(entry, 'fired a timer that was not pending');
        else {
          if (timer.incarnation !== entry.incarnation) fail(entry, `timer from incarnation ${timer.incarnation} fired in ${entry.incarnation}`);
          if (timer.fireAt !== entry.time) fail(entry, `timer due at ${timer.fireAt} fired at ${entry.time}`);
          timer.pending = false;
        }
        break;
      }
      case 'storage.write': {
        const storage = (nodes.get(entry.node) as { storage: Map<string, JsonValue> }).storage;
        for (const [key, value] of Object.entries(entry.set)) storage.set(key, value);
        for (const key of entry.deleted) storage.delete(key);
        break;
      }
      case 'message.send': {
        messages.set(entry.messageId, { send: entry, resolved: false });
        if (entry.deliverAt === null) {
          const next = trace[entry.index + 1];
          if (next?.kind !== 'message.drop' || next.messageId !== entry.messageId) fail(entry, 'deliverAt null without an immediate drop');
        }
        break;
      }
      case 'message.deliver':
      case 'message.drop': {
        const message = messages.get(entry.messageId);
        if (message === undefined || message.resolved) {
          fail(entry, 'message delivered or dropped twice, or never sent');
          break;
        }
        message.resolved = true;
        const { send } = message;
        if (entry.cause !== send.index) fail(entry, 'cause must be the message.send entry');
        if (entry.kind === 'message.deliver') {
          if (entry.time !== send.deliverAt) fail(entry, `delivered at ${entry.time}, scheduled for ${send.deliverAt}`);
          if (separated(send.node, send.to)) fail(entry, 'delivered across a partition');
          break;
        }
        const condition = trace[entry.conditionIndex];
        const expectedKind = { partitioned: 'network.partition', 'partitioned-in-flight': 'network.partition', lost: 'link.fault', 'node-down': 'node.crash' }[
          entry.reason
        ];
        if (condition?.kind !== expectedKind) fail(entry, `${entry.reason} drop must point at a ${expectedKind} entry`);
        if (entry.reason.startsWith('partitioned') && !separated(send.node, send.to)) fail(entry, 'partition drop without a partition');
        if (entry.reason === 'node-down' && nodes.get(entry.node)?.status !== 'crashed') fail(entry, 'node-down drop for a live node');
        if (entry.reason === 'node-down' && separated(send.node, send.to)) fail(entry, 'network checks must precede node checks');
        if (entry.reason === 'partitioned' && entry.time !== send.time) fail(entry, 'send-time partition drop at the wrong time');
        if (entry.reason === 'partitioned-in-flight' && entry.time !== send.deliverAt) fail(entry, 'in-flight drop at the wrong time');
        break;
      }
      case 'run.end':
        if (entry.reason === 'quiescent') {
          for (const [id, m] of messages) if (!m.resolved) fail(entry, `message ${id} neither delivered nor dropped`);
          for (const [id, t] of timers) if (t.pending) fail(entry, `timer ${id} still pending`);
          for (const fault of start.faults) if (!appliedFaults.has(fault.id)) fail(entry, `fault ${fault.id} never applied`);
        }
        break;
    }
  }
  return violations;
}

/** Persistent storage per node as re-derived from `storage.write` entries. */
export function storageFromTrace(trace: readonly TraceEntry[]): Map<NodeId, Record<string, JsonValue>> {
  const result = new Map<NodeId, Record<string, JsonValue>>();
  for (const entry of trace) {
    if (entry.kind !== 'storage.write') continue;
    const current = { ...(result.get(entry.node) ?? {}), ...entry.set };
    for (const key of entry.deleted) delete current[key];
    result.set(entry.node, current);
  }
  return result;
}
