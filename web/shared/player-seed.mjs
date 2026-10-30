// Session seed for the official player. A shipped game gets fresh
// api.random rolls on each launch; `?seed=<u64>` reproduces a reported session.
// Development hosts and verification runners keep their own fixed seeds.
const MAX_SEED = (1n << 64n) - 1n;

export function playerSeed(search, random = globalThis.crypto) {
  const requested = new URLSearchParams(search).get('seed');
  if (requested !== null) {
    if (!/^(0|[1-9][0-9]{0,19})$/.test(requested) || BigInt(requested) > MAX_SEED) {
      throw new Error(`PLAYER_SEED_INVALID: ?seed= must be a decimal integer in 0..${MAX_SEED}`);
    }
    return {seed: requested, source: 'url'};
  }
  const words = random.getRandomValues(new Uint32Array(2));
  return {seed: ((BigInt(words[0]) << 32n) | BigInt(words[1])).toString(), source: 'random'};
}
