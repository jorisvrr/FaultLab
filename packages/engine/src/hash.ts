/**
 * 32-bit FNV-1a over the UTF-8 encoding of a string.
 *
 * Used for deriving PRNG stream seeds from labels and for short, human-readable trace
 * fingerprints. It is NOT a cryptographic hash and collisions are possible, so equality of
 * traces is always decided by comparing the full canonical serialisation, never the hash.
 *
 * Encoding is done by hand because TextEncoder is not part of the ECMAScript standard
 * library the engine is compiled against (see tsconfig.json).
 */
export const FNV1A32_OFFSET = 0x811c9dc5;

export function fnv1a32(text: string): number {
  return fnv1a32Update(FNV1A32_OFFSET, text);
}

/** Continue an FNV-1a 32 hash with more text: fnv1a32(a + b) === fnv1a32Update(fnv1a32(a), b). */
export function fnv1a32Update(state: number, text: string): number {
  let hash = state;
  const mix = (byte: number): void => {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  };
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp < 0x80) {
      mix(cp);
    } else if (cp < 0x800) {
      mix(0xc0 | (cp >> 6));
      mix(0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      // Lone surrogates are encoded as-is (WTF-8) so hashing never throws.
      mix(0xe0 | (cp >> 12));
      mix(0x80 | ((cp >> 6) & 0x3f));
      mix(0x80 | (cp & 0x3f));
    } else {
      mix(0xf0 | (cp >> 18));
      mix(0x80 | ((cp >> 12) & 0x3f));
      mix(0x80 | ((cp >> 6) & 0x3f));
      mix(0x80 | (cp & 0x3f));
    }
  }
  return hash >>> 0;
}

export function toHex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
