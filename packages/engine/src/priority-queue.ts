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

  /**
   * Keep only the items for which `keep` returns true, then restore the heap property with
   * Floyd's bottom-up heapify: sift down every internal node, from the last parent to the root.
   *
   * Why this is O(n) and not O(n log n): half the nodes are leaves (no work), a quarter sit one
   * level up (at most 1 swap), an eighth two levels up (at most 2), ... The sum n/4·1 + n/8·2 +
   * n/16·3 + ... converges to n. Building by n separate pushes would cost O(n log n).
   */
  retain(keep: (item: T) => boolean): void {
    const items = this.#items;
    let write = 0;
    for (let read = 0; read < items.length; read++) {
      const item = items[read] as T;
      if (keep(item)) items[write++] = item;
    }
    items.length = write;
    for (let i = (write >> 1) - 1; i >= 0; i--) this.#siftDown(i);
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
