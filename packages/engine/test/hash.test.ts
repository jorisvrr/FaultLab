import { describe, expect, it } from 'vitest';
import { fnv1a32, toHex32 } from '../src/hash';

describe('fnv1a32', () => {
  it('matches the published FNV-1a 32-bit test vectors', () => {
    // http://www.isthe.com/chongo/src/fnv/test_fnv.c
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('hashes the UTF-8 encoding of non-ASCII text', () => {
    // "é" is C3 A9 in UTF-8; hashing those two bytes by hand must agree.
    let h = 0x811c9dc5;
    for (const byte of [0xc3, 0xa9]) h = Math.imul(h ^ byte, 0x01000193);
    expect(fnv1a32('é')).toBe(h >>> 0);
    expect(() => fnv1a32('\ud800 lone surrogate 🎲')).not.toThrow();
  });

  it('formats as 8 lowercase hex digits', () => {
    expect(toHex32(0)).toBe('00000000');
    expect(toHex32(0xbf9cf968)).toBe('bf9cf968');
  });
});
