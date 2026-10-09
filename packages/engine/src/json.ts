import { InvalidJsonError } from './errors';

export type JsonPrimitive = null | boolean | number | string;
export type JsonArray = readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * Every value produced by `toFrozenJson` is registered here. Because those values are deeply
 * frozen and already validated, they can be reused as-is, which makes immutable updates with
 * structural sharing (`{ ...state, count: state.count + 1 }`) cost O(changed part) instead of
 * O(whole state). Membership only affects performance, never the resulting value.
 */
const validated = new WeakSet<object>();

/**
 * Validate that `value` is plain JSON data and return a deeply frozen copy of it.
 *
 * This is the trust boundary between protocol code and the engine. Copying prevents aliasing
 * (a sender mutating a payload after `send()`), freezing prevents receivers from mutating
 * shared data, and the JSON restriction guarantees that payloads and state can be serialised
 * into traces and snapshots without loss.
 *
 * Rejected: undefined, functions, symbols, bigints, NaN/Infinity, sparse arrays, cycles,
 * accessor properties, symbol keys, and objects whose prototype is not Object.prototype or
 * null (class instances, Map, Set, Date, Promise, ...). `-0` is normalised to `0` because JSON
 * cannot represent it.
 */
export function toFrozenJson(value: unknown, path = '$'): JsonValue {
  return copy(value, path, new Set());
}

function copy(value: unknown, path: string, ancestors: Set<object>): JsonValue {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new InvalidJsonError(path, `${String(value)} is not a finite number`);
      }
      return Object.is(value, -0) ? 0 : value;
    case 'object':
      if (value === null) return null;
      break;
    default:
      throw new InvalidJsonError(path, `${typeof value} is not a JSON value`);
  }

  if (validated.has(value)) return value as JsonValue;
  if (ancestors.has(value)) throw new InvalidJsonError(path, 'circular reference');
  ancestors.add(value);
  try {
    const result = Array.isArray(value)
      ? copyArray(value, path, ancestors)
      : copyObject(value, path, ancestors);
    validated.add(result);
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function copyArray(value: readonly unknown[], path: string, ancestors: Set<object>): JsonArray {
  const out: JsonValue[] = [];
  for (let i = 0; i < value.length; i++) {
    if (!(i in value)) throw new InvalidJsonError(`${path}[${i}]`, 'sparse array hole');
    out.push(copy(value[i], `${path}[${i}]`, ancestors));
  }
  return Object.freeze(out);
}

function copyObject(value: object, path: string, ancestors: Set<object>): JsonObject {
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const name = (value.constructor as { name?: unknown } | undefined)?.name;
    throw new InvalidJsonError(path, `${typeof name === 'string' ? name : 'object'} is not a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new InvalidJsonError(path, 'symbol keys are not allowed');
  }
  // Collected first, then created with Object.fromEntries: like defineProperty (and unlike plain
  // assignment) it creates own data properties without invoking setters, so a "__proto__" key
  // becomes an own data property instead of replacing the copy's prototype. It is ≈ 1.6× faster
  // than defining keys one by one (PERF-5, CP5). Same keys, order and values, frozen: the result
  // is indistinguishable.
  const entries: [string, JsonValue][] = [];
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new InvalidJsonError(`${path}.${key}`, 'accessor properties are not allowed');
    }
    entries.push([key, copy(descriptor.value, `${path}.${key}`, ancestors)]);
  }
  return Object.freeze(Object.fromEntries(entries) as JsonObject);
}

/**
 * Deterministic JSON serialisation: object keys are sorted by UTF-16 code unit order, so two
 * structurally equal values always serialise to the same string regardless of the order in
 * which their properties were created. Used for trace comparison and fingerprints.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${(value as JsonArray).map(canonicalJson).join(',')}]`;
  }
  const object = value as JsonObject;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key] as JsonValue)}`).join(',')}}`;
}
