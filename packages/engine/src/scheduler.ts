import { EngineInvariantError } from './errors';
import { BinaryHeap } from './priority-queue';
import { VirtualClock, isVirtualTime, type VirtualTime } from './time';

/** Sequence number assigned when an event is scheduled. Unique and strictly increasing. */
export type EventSeq = number;

export const DEFAULT_COMPACTION_THRESHOLD = 1024;

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
 * discarded when it reaches the top. Dead entries only surface at their scheduled time, so a
 * workload that keeps resetting long timers would accumulate them without bound. To prevent
 * that, the heap is compacted when dead entries outnumber live ones (ADR-0011). Compaction
 * cannot change the dispatch order: with a strict total order, every valid heap over the same
 * live events pops them in the same sequence.
 */
export class EventScheduler<E> {
  readonly #heap = new BinaryHeap<ScheduledEvent<E>>(compareScheduled);
  readonly #live = new Set<EventSeq>();
  readonly #clock = new VirtualClock();
  readonly #compactionThreshold: number;
  #nextSeq: EventSeq = 0;
  #compactions = 0;

  /** @param compactionThreshold minimum number of dead entries before a compaction is considered. */
  constructor(options: { readonly compactionThreshold?: number } = {}) {
    this.#compactionThreshold = options.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
  }

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

  /**
   * Rebuild a scheduler from exported state (CP3 snapshots). `events` must be the live events
   * with their ORIGINAL sequence numbers; the clock is set to `now` and the next sequence number
   * to `nextSeq`, so future scheduling assigns exactly the numbers an uninterrupted run would.
   * Validation of untrusted input happens in snapshot.ts before this is called.
   */
  static restore<E>(
    state: { readonly now: VirtualTime; readonly nextSeq: EventSeq; readonly events: readonly ScheduledEvent<E>[] },
    options: { readonly compactionThreshold?: number } = {},
  ): EventScheduler<E> {
    const scheduler = new EventScheduler<E>(options);
    scheduler.#clock.advanceTo(state.now);
    for (const scheduled of state.events) {
      if (scheduled.seq >= state.nextSeq || scheduler.#live.has(scheduled.seq)) {
        throw new EngineInvariantError(`restored event seq ${scheduled.seq} is invalid`);
      }
      if (scheduled.time < state.now) throw new EngineInvariantError(`restored event at ${scheduled.time} is before now`);
      scheduler.#heap.push(scheduled);
      scheduler.#live.add(scheduled.seq);
    }
    scheduler.#nextSeq = state.nextSeq;
    return scheduler;
  }

  /** The sequence number the next scheduled event will receive. */
  get nextSeq(): EventSeq {
    return this.#nextSeq;
  }

  /** Returns true if the event was pending and is now cancelled; false if it already ran or was cancelled. */
  cancel(seq: EventSeq): boolean {
    if (!this.#live.delete(seq)) return false;
    const dead = this.#heap.size - this.#live.size;
    if (dead >= this.#compactionThreshold && dead > this.#live.size) {
      // Every compaction removes at least half the array, so its O(n) cost is amortised O(1)
      // per cancellation.
      this.#heap.retain((scheduled) => this.#live.has(scheduled.seq));
      this.#compactions++;
    }
    return true;
  }

  /** Diagnostics: live events, physical heap entries (live + not-yet-discarded dead), compactions so far. */
  get stats(): { readonly pending: number; readonly heapEntries: number; readonly compactions: number } {
    return { pending: this.#live.size, heapEntries: this.#heap.size, compactions: this.#compactions };
  }

  /**
   * All live events in dispatch order (cancelled ones excluded). O(n log n); meant for
   * diagnostics, consistency tests and future snapshots, not for the hot path.
   */
  liveEvents(): readonly ScheduledEvent<E>[] {
    const live: ScheduledEvent<E>[] = [];
    const heap = new BinaryHeap<ScheduledEvent<E>>(compareScheduled);
    this.#heap.forEach((scheduled) => {
      if (this.#live.has(scheduled.seq)) heap.push(scheduled);
    });
    for (let next = heap.pop(); next !== undefined; next = heap.pop()) live.push(next);
    return Object.freeze(live);
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
