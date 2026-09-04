# Issue: Slot Machine fixture guessed a deterministic result

## Symptom

The first Slot Machine test expected `[1,1,1]`, credits `17`, and a win for seed `42`. The engine replay correctly produced `[2,2,1]`, credits `2`, and no win, so the test failed.

## Classification

Game validation fixture issue, not an engine or architecture issue. The expected value was guessed instead of being generated from a recorded deterministic replay.

## Fix

Run the exact semantic input sequence through `game run`, use the observed result as the explicit fixture, and keep the test assertion in the game repository. Add a separate sequence file for manual replay so the test manifest cannot be passed accidentally to `--input-sequence`.

## Regression

The corrected spin test must pass with seed `42`, and the manual sequence must produce the same observation digest. RNG implementation remains in the engine; reels, paytable and credits remain in Luau.
