/**
 * Array-backed binary min-heap.
 *
 * push and pop are O(log n), peek is O(1). A heap is NOT stable: two items that compare equal
 * may come out in any order. Callers that need deterministic output must therefore supply a
 * comparator that is a strict total order (never returns 0 for distinct items). The event
 * scheduler does this by breaking time ties with a unique sequence number.
 */
export class BinaryHeap<T> {
  readonly #items: T[] = [];
  readonly #compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.#compare = compare;
  }

  get size(): number {
    return this.#items.length;
  }

  peek(): T | undefined {
    return this.#items[0];
  }

  push(item: T): void {
    this.#items.push(item);
    this.#siftUp(this.#items.length - 1);
  }

  pop(): T | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last !== undefined) {
      items[0] = last;
      this.#siftDown(0);
    }
    return top;
  }

  /** Children of i live at 2i+1 and 2i+2; the parent of i lives at floor((i-1)/2). */
  #siftUp(index: number): void {
    const items = this.#items;
    const item = items[index] as T;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = items[parentIndex] as T;
      if (this.#compare(item, parent) >= 0) break;
      items[index] = parent;
      index = parentIndex;
    }
    items[index] = item;
  }

  #siftDown(index: number): void {
    const items = this.#items;
    const length = items.length;
    const item = items[index] as T;
    for (;;) {
      const left = 2 * index + 1;
      if (left >= length) break;
      const right = left + 1;
      let smallest = left;
      if (right < length && this.#compare(items[right] as T, items[left] as T) < 0) smallest = right;
      if (this.#compare(items[smallest] as T, item) >= 0) break;
      items[index] = items[smallest] as T;
      index = smallest;
    }
    items[index] = item;
  }
}
