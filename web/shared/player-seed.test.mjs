import test from 'node:test';
import assert from 'node:assert/strict';
import {playerSeed} from './player-seed.mjs';

const fixed = words => ({getRandomValues: array => (array.set(words), array)});

test('official player draws a fresh full-width u64 seed per launch', () => {
  assert.deepEqual(playerSeed('', fixed([1, 2])), {seed: String((1n << 32n) + 2n), source: 'random'});
  assert.deepEqual(playerSeed('?backend=worker', fixed([0xffffffff, 0xffffffff])),
    {seed: '18446744073709551615', source: 'random'});
  assert.notEqual(playerSeed('').seed, playerSeed('').seed);
});

test('a reported seed reproduces the session exactly', () => {
  assert.deepEqual(playerSeed('?seed=42', fixed([7, 7])), {seed: '42', source: 'url'});
  assert.deepEqual(playerSeed('?seed=18446744073709551615'), {seed: '18446744073709551615', source: 'url'});
  for (const bad of ['', '-1', '01', '4.2', '1e3', '18446744073709551616', 'abc']) {
    assert.throws(() => playerSeed(`?seed=${encodeURIComponent(bad)}`), /PLAYER_SEED_INVALID/);
  }
});
