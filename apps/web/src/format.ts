import type { TraceEntry } from '@faultlab/engine';

/** One-line description of a trace entry, from its own fields only (pure; reusable in CP6). */
export function describeEntry(e: TraceEntry): string {
  switch (e.kind) {
    case 'run.start':
      return `${e.protocol.name}@${e.protocol.version}, seed ${e.seed}, ${e.nodes.length} nodes, engine ${e.engineVersion}`;
    case 'node.start':
      return `${e.node} starts (incarnation ${e.incarnation})`;
    case 'message.send':
      return `${e.node} → ${e.to} ${payloadLabel(e.payload)}${e.deliverAt === null ? ' (dropped at send)' : ` · arrives t=${e.deliverAt}`}`;
    case 'message.deliver':
      return `${e.from} → ${e.node} delivered ${payloadLabel(e.payload)}`;
    case 'message.drop':
      return `${e.from} → ${e.node} dropped (${e.reason})`;
    case 'timer.set':
      return `${e.node} sets ${e.tag} for t=${e.fireAt}`;
    case 'timer.fire':
      return `${e.node} ${e.tag} fires`;
    case 'timer.cancel':
      return `${e.node} cancels ${e.timerId}`;
    case 'state.update':
      return `${e.node} state updated`;
    case 'storage.write':
      return `${e.node} stores ${Object.keys(e.set).join(', ') || '—'}${e.deleted.length > 0 ? `, deletes ${e.deleted.join(', ')}` : ''}`;
    case 'protocol.error':
      return `${e.node}: ${e.error}`;
    case 'node.crash':
      return `${e.node} crashes`;
    case 'node.recover':
      return `${e.node} recovers (incarnation ${e.incarnation})`;
    case 'network.partition':
      return `partition ${e.groups.map((g) => `[${g.join(' ')}]`).join(' | ')}`;
    case 'network.heal':
      return 'partition healed';
    case 'link.fault':
      return `link ${e.from}→${e.to} degraded (loss ${e.loss}, delay ${e.delay.min}–${e.delay.max})`;
    case 'link.restore':
      return `link ${e.from}→${e.to} restored`;
    case 'fault.skipped':
      return `${e.faultType} ${e.node} skipped (${e.reason})`;
    case 'invariant.violation':
      return `${e.invariant.id}: ${e.observed}`;
    case 'invariant.cleared':
      return `${e.invariant.id} holds again`;
    case 'invariant.error':
      return `${e.invariant.id} failed: ${e.error}`;
    case 'liveness.armed':
      return `${e.check.id}: progress expected by t=${e.deadlineAt}`;
    case 'liveness.met':
      return `${e.check.id}: progress after ${e.duration} ticks${e.late ? ' (late)' : ''}`;
    case 'liveness.missed':
      return `${e.check.id}: no progress by t=${e.deadlineAt} (a test bound under stated assumptions)`;
    case 'liveness.disarmed':
      return `${e.check.id}: assumptions no longer hold`;
    case 'liveness.error':
      return `${e.check.id} failed: ${e.error}`;
    case 'run.end':
      return `run ended: ${e.reason} after ${e.eventsProcessed} events`;
  }
}

function payloadLabel(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null && 'type' in payload) {
    const p = payload as { type: unknown; term?: unknown; voteGranted?: unknown };
    return `${String(p.type)}${typeof p.term === 'number' ? ` (term ${p.term}${p.voteGranted === true ? ', granted' : p.voteGranted === false ? ', rejected' : ''})` : ''}`;
  }
  return JSON.stringify(payload).slice(0, 40);
}

/** Entry kinds that are faults, results or errors (for emphasis in lists). */
export function entryTone(e: TraceEntry): 'fault' | 'violation' | 'liveness' | 'error' | null {
  if (['node.crash', 'node.recover', 'network.partition', 'network.heal', 'link.fault', 'link.restore', 'fault.skipped'].includes(e.kind)) return 'fault';
  if (e.kind === 'invariant.violation') return 'violation';
  if (e.kind.startsWith('liveness.')) return 'liveness';
  if (e.kind.endsWith('.error') || (e.kind === 'message.drop')) return 'error';
  return null;
}
