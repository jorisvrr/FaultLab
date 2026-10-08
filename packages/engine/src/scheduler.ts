import { EngineInvariantError } from './errors';
import { BinaryHeap } from './priority-queue';
import { VirtualClock, isVirtualTime, type VirtualTime } from './time';

/** Sequence number assigned when an event is scheduled. Unique and strictly increasing. */
export type EventSeq = number;

export interface ScheduledEvent<E> {
  readonly time: VirtualTime;
  readonly seq: EventSeq;
  readonly event: E;
}

/**
 * THE ordering rule of the simulation: earlier virtual time first; for equal times, the event
 * that was scheduled first goes first (FIFO). Because `seq` is unique this is a strict total
 * order, so the non-stable heap still produces exactly one possible dispatch order.
 */
export function compareScheduled<E>(a: ScheduledEvent<E>, b: ScheduledEvent<E>): number {
  return a.time - b.time || a.seq - b.seq;
}

/**
 * Deterministic discrete-event scheduler: a priority queue of future events plus the virtual
 * clock. Dispatching an event advances the clock to that event's time.
 *
 * Cancellation is lazy: a cancelled event stays in the heap but is no longer "live", and is
 * discarded when it reaches the top. This keeps cancel O(1) at the cost of some memory held
 * by dead entries until they surface.
 */
export class EventScheduler<E> {
  readonly #heap = new BinaryHeap<ScheduledEvent<E>>(compareScheduled);
  readonly #live = new Set<EventSeq>();
  readonly #clock = new VirtualClock();
  #nextSeq: EventSeq = 0;

  get now(): VirtualTime {
    return this.#clock.now;
  }

  /** Number of events that will still be dispatched (cancelled events excluded). */
  get pendingCount(): number {
    return this.#live.size;
  }

  schedule(time: VirtualTime, event: E): EventSeq {
    if (!isVirtualTime(time)) {
      throw new EngineInvariantError(`cannot schedule at non-integer or negative time ${String(time)}`);
    }
    if (time < this.#clock.now) {
      throw new EngineInvariantError(`cannot schedule at ${time}, which is before now (${this.#clock.now})`);
    }
    const seq = this.#nextSeq++;
    this.#heap.push({ time, seq, event });
    this.#live.add(seq);
    return seq;
  }

  /** Returns true if the event was pending and is now cancelled; false if it already ran or was cancelled. */
  cancel(seq: EventSeq): boolean {
    return this.#live.delete(seq);
  }

  isPending(seq: EventSeq): boolean {
    return this.#live.has(seq);
  }

  /** The next live event without dispatching it or advancing the clock. */
  peek(): ScheduledEvent<E> | undefined {
    this.#discardCancelled();
    return this.#heap.peek();
  }

  /** Remove the next live event and advance the clock to its time. */
  next(): ScheduledEvent<E> | undefined {
    this.#discardCancelled();
    const scheduled = this.#heap.pop();
    if (scheduled === undefined) return undefined;
    this.#live.delete(scheduled.seq);
    this.#clock.advanceTo(scheduled.time);
    return scheduled;
  }

  #discardCancelled(): void {
    let top = this.#heap.peek();
    while (top !== undefined && !this.#live.has(top.seq)) {
      this.#heap.pop();
      top = this.#heap.peek();
    }
  }
}
