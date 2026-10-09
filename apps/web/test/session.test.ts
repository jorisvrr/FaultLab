import { fingerprintTrace, runSimulation } from '@faultlab/engine';
import { PRESETS, resolveExperiment } from '@faultlab/experiments';
import { WorkerCore, type Command, type WorkerLike } from '@faultlab/runtime';
import { describe, expect, it } from 'vitest';
import { Session } from '../src/state/session';

/** The app's framework-free Session, against an in-memory Worker (real WorkerCore, async messages). */
const now = performance.now.bind(performance);
function memoryWorker(): WorkerLike {
  let terminated = false;
  const worker: WorkerLike & { core?: WorkerCore } = {
    onmessage: null,
    onerror: null,
    postMessage: (m: Command) => !terminated && setImmediate(() => !terminated && worker.core!.receive(structuredClone(m))),
    terminate: () => void (terminated = true),
  };
  worker.core = new WorkerCore({ post: (e) => !terminated && setImmediate(() => !terminated && worker.onmessage?.({ data: structuredClone(e) })), schedule: setImmediate, now, encode: (t) => new TextEncoder().encode(t) });
  return worker;
}
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;
const until = (session: Session, test: () => boolean) =>
  new Promise<void>((resolve) => {
    const check = () => test() && (off(), resolve());
    const off = session.subscribe(check);
    check();
  });

async function completed(id: string): Promise<Session> {
  const session = new Session({ createWorker: memoryWorker });
  const p = preset(id);
  session.load(p.spec, p);
  await until(session, () => session.view.run.lifecycle === 'ready');
  session.run();
  await until(session, () => session.view.run.fingerprint?.matches === true);
  return session;
}

describe('Session (UI state, never reaching the simulation)', () => {
  it('notifies user changes at once (controlled inputs), and coalesces data changes per frame', async () => {
    // A deferred scheduler, like requestAnimationFrame: nothing runs until we flush it.
    const frames: (() => void)[] = [];
    const flush = () => frames.splice(0).forEach((fn) => fn());
    const session = new Session({ createWorker: memoryWorker, schedule: (fn) => frames.push(fn) });
    const seen: boolean[] = [];
    session.subscribe(() => seen.push(session.view.follow));
    const p = preset('raft-isolate-leader');
    session.load(p.spec, p);
    expect(seen, 'load is a user action: listeners hear it in the same task').toEqual([true]);
    // Every user change, including rapid toggling, is heard immediately and in order.
    for (const follow of [false, true, false, true, false]) session.setFollow(follow);
    expect(seen.slice(1)).toEqual([false, true, false, true, false]);
    session.setCursor(0);
    session.selectNode('n1');
    expect(seen).toHaveLength(8);
    // Data (Worker events) is coalesced: many client updates, one notification per flushed frame.
    seen.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen, 'no data notification before the frame').toEqual([]);
    expect(frames.length).toBeLessThanOrEqual(1);
    flush();
    expect(seen).toHaveLength(1);
    session.dispose();
  });

  it('follows the newest entry while live, and stops following when the user moves the cursor', async () => {
    const session = await completed('raft-isolate-leader');
    expect(session.view.follow).toBe(true);
    expect(session.view.cursor).toBe(session.view.length - 1);
    session.setCursor(10);
    expect(session.view).toMatchObject({ cursor: 10, follow: false });
    session.setFollow(true);
    expect(session.view.cursor).toBe(session.view.length - 1);
    expect(fingerprintTrace(session.trace.index!.trace)).toBe(fingerprintTrace(runSimulation(resolveExperiment(preset('raft-isolate-leader').spec).config).trace));
  });

  it('moves by entries, simulation steps and markers to exact entries; clamps at the ends', async () => {
    const session = await completed('heartbeat-crash-partition');
    const index = session.trace.index!;
    session.setCursor(0);
    session.moveEntries(-5);
    expect(session.view.cursor).toBe(0);
    session.moveSteps(1);
    expect(session.view.cursor).toBe(index.step(1).last);
    session.moveSteps(1);
    expect(session.view.cursor).toBe(index.step(2).last);
    session.moveMarker(1);
    expect(index.entry(session.view.cursor).kind).toBe('node.crash');
    session.moveMarker(1, ['heal']);
    expect(index.entry(session.view.cursor).kind).toBe('network.heal');
    session.setCursor(1e9);
    expect(session.view.cursor).toBe(index.length - 1);
  });

  it('describes nodes through the protocol’s registry view adapter', async () => {
    const session = await completed('raft-healthy');
    const frame = session.trace.index!.frameAt(session.view.cursor);
    expect(session.describe(frame.nodes.find((n) => n.id === 'n5')!.state)).toMatchObject({ role: 'leader', term: 1, leader: true });
  });

  it('a new load resets trace, cursor and selection (no data from the previous run)', async () => {
    const session = await completed('raft-healthy');
    session.selectNode('n2');
    session.load(preset('naive-healthy').spec, preset('naive-healthy'));
    expect(session.view).toMatchObject({ length: 0, cursor: 0, selectedNode: null, follow: true });
    await until(session, () => session.view.run.lifecycle === 'ready');
    expect(session.trace.index!.start.protocol.name).toBe('naive-leader');
  });
});
