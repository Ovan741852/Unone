# Age, lifespan, and injury balance

This is gameplay/business logic owned by `scripts/main.luau`; it is not an engine primitive.

- Each reset assigns `startingAge = 20 + ((index * 17) % 41)`, giving 40 stable, distinct adult ages.
- One simulated game day is one age year (`8` game minutes per real second at speed 1, so one age year is about three real minutes). This is intentionally stream-friendly and is derived from `worldMinutes`, not sampled per frame.
- Natural death is checked at most once per resident per game day after absolute `lifespan` age. The deterministic bounded check is 18%, with no immediate mass extinction; it uses the resident seed and day rather than a frame roll.
- Resting or sleeping at the resident's home heals `0.025` injury per game minute. Walking, working, and occupied interactions do not heal.
- Direct attack base damage is clamped to `3..8`; critical hits use `1.35x`. Misses remain zero damage. Four strikes can injure a healthy target but do not routinely kill it; repeated attacks can still reach `injury=100` and use `killNpc`.
- NanoJev remains the only intention authority: ordinary `after_current` plans wait for the current unit/arrival, an in-flight non-urgent same intent preserves its route, and `interrupt_now` may switch at the safe boundary and clear the old route.
