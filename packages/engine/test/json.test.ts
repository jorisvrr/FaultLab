import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidJsonError } from '../src/errors';
import { canonicalJson, toFrozenJson } from '../src/json';

describe('toFrozenJson', () => {
  it('returns an equal, deeply frozen copy that does not alias the input', () => {
    const input = { a: 1, nested: { list: [1, { b: 'x' }] } };
    const output = toFrozenJson(input) as typeof input;
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.nested.list[1])).toBe(true);
    input.nested.list.push(2);
    expect(output.nested.list).toHaveLength(2);
  });

  it('round-trips any JSON value (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(JSON.stringify(toFrozenJson(value)))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });

  it('reuses already-validated frozen subtrees (structural sharing)', () => {
    const first = toFrozenJson({ big: { deep: [1, 2, 3] }, n: 0 }) as { big: object; n: number };
    const next = toFrozenJson({ ...first, n: 1 }) as { big: object; n: number };
    expect(next.big).toBe(first.big);
  });

  it('normalises -0 to 0', () => {
    expect(Object.is(toFrozenJson(-0), 0)).toBe(true);
  });

  it('keeps "__proto__" as an own data key instead of changing the prototype', () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}}') as object;
    const output = toFrozenJson(input) as Record<string, unknown>;
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.keys(output)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  const sparse = [1, , 3];
  const withGetter = Object.defineProperty({}, 'x', { get: () => 1, enumerable: true });

  it.each([
    ['undefined', undefined],
    ['function', () => 1],
    ['symbol', Symbol('s')],
    ['bigint', 1n],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['nested undefined', { a: undefined }],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['class instance', new (class Point {})()],
    ['Promise', Promise.resolve(1)],
    ['cycle', cyclic],
    ['sparse array', sparse],
    ['accessor property', withGetter],
    ['symbol key', { [Symbol('k')]: 1 }],
  ])('rejects %s', (_label, value) => {
    expect(() => toFrozenJson(value)).toThrow(InvalidJsonError);
  });

  it('reports the path of the offending value', () => {
    expect(() => toFrozenJson({ a: [0, { b: Number.NaN }] }, 'payload')).toThrow('payload.a[1].b');
  });

  it('accepts shared (non-cyclic) references', () => {
    const shared = { x: 1 };
    expect(toFrozenJson({ a: shared, b: shared })).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });
});

describe('canonicalJson', () => {
  it('is independent of property insertion order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonicalJson({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}');
  });

  it('parses back to an equal value (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(canonicalJson(toFrozenJson(value)))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });
});
