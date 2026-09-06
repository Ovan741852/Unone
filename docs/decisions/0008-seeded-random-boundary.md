# Decision 0008: Seeded Random Is an Engine Primitive; Random Rules Stay in the Game

## Context

The long-term validation set includes an auto battler, a slot machine, a fish arcade game, and idle combat; AI needs to replay the same seed and input. Originally, `RunReport.seed` recorded only metadata and did not actually affect the runtime.

## Decision

- The Rust runtime owns deterministic RNG state, and the seed is injected when the runtime is created.
- Luau sees only `api.random.nextFloat()` and `api.random.nextInt(min, max)`.
- `nextInt` is an inclusive integer range, rejects `min > max`, and uses rejection sampling to avoid modulo bias.
- Distributions, draw weights, slot reels, fish-school rules, and game-outcome decisions stay in Luau; the engine does not provide a game-specific random system.
- The same seed, input sequence, and random-call order are all required for deterministic replay.

## Consequence

Headless tests can validate random-game rules without putting each game's probability design into the engine. If networking or asynchronous work is added later, scheduling/network mocks must also be included in the deterministic contract; seed alone is not sufficient.
