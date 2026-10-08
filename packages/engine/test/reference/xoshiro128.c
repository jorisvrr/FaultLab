/* xoshiro128** 1.1 reference (Blackman & Vigna, public domain), plus the SplitMix32/fmix32 seeding used by FaultLab. */
#include <stdint.h>
#include <stdio.h>
static inline uint32_t rotl(const uint32_t x, int k) { return (x << k) | (x >> (32 - k)); }
static uint32_t s[4];
uint32_t next(void) {
  const uint32_t result = rotl(s[1] * 5, 7) * 9;
  const uint32_t t = s[1] << 9;
  s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 11);
  return result;
}
static uint32_t sm;
uint32_t splitmix32(void) {
  uint32_t z = (sm += 0x9e3779b9u);
  z = (z ^ (z >> 16)) * 0x85ebca6bu; z = (z ^ (z >> 13)) * 0xc2b2ae35u; return z ^ (z >> 16);
}
int main(void) {
  s[0]=1; s[1]=2; s[2]=3; s[3]=4;
  printf("state[1,2,3,4]:"); for (int i=0;i<8;i++) printf(" %u", next()); printf("\n");
  uint32_t seeds[] = {0u, 42u, 4294967295u};
  for (int j=0;j<3;j++) { sm = seeds[j]; for (int i=0;i<4;i++) s[i]=splitmix32();
    printf("seed %u state: %u %u %u %u | out:", seeds[j], s[0], s[1], s[2], s[3]);
    for (int i=0;i<6;i++) printf(" %u", next()); printf("\n"); }
}
/*
 * Regenerate the vectors used in test/random.test.ts:
 *   clang -O2 -o /tmp/xoshiro128 packages/engine/test/reference/xoshiro128.c && /tmp/xoshiro128
 */
