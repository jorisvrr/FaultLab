import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BinaryHeap } from '../src/priority-queue';

const byNumber = (a: number, b: number): number => a - b;

describe('BinaryHeap', () => {
  it('is empty initially', () => {
    const heap = new BinaryHeap(byNumber);
    expect(heap.size).toBe(0);
    expect(heap.peek()).toBeUndefined();
    expect(heap.pop()).toBeUndefined();
  });

  it('pops in sorted order (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (values) => {
        const heap = new BinaryHeap(byNumber);
        values.forEach((v) => heap.push(v));
        const popped: number[] = [];
        while (heap.size > 0) popped.push(heap.pop() as number);
        expect(popped).toEqual([...values].sort(byNumber));
      }),
    );
  });

  it('agrees with a sorted-array model under interleaved push/pop (model-based property)', () => {
    const op = fc.oneof(fc.record({ push: fc.integer({ min: 0, max: 20 }) }), fc.constant({ pop: true as const }));
    fc.assert(
      fc.property(fc.array(op, { maxLength: 200 }), (ops) => {
        const heap = new BinaryHeap(byNumber);
        const model: number[] = [];
        for (const o of ops) {
          if ('push' in o) {
            heap.push(o.push);
            model.push(o.push);
            model.sort(byNumber);
          } else {
            expect(heap.pop()).toBe(model.shift());
          }
          expect(heap.size).toBe(model.length);
          expect(heap.peek()).toBe(model[0]);
        }
      }),
    );
  });
});
