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
