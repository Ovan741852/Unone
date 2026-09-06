# Decision 0012: Sprite Size Is a Scene Contract; Asset Content Does Not Enter the Core

- Date: 2026-09-05
- Status: accepted

## Context

The first Angry Birds native preview drew every entity as a fixed-size quad. This made the sprite declared by the Scene disagree with the display and made it impossible for AI to determine presentation size from the observation or Scene. At the same time, there is not yet enough evidence to add complete texture import, atlases, materials, or a game-specific sprite renderer to the engine core.

## Decision

Add the required `size: Vec2` Scene field to `SpriteData`, defaulting to `1 x 1`, and require the engine to reject values whose x or y is not a finite number greater than 0 when loading a Scene. The native preview draws a procedural quad according to this contract; decoding, downloading, caching, and art arrangement for real assets remain later asset-pipeline/host work.

Size is presentation geometry the engine needs to understand; the game project still decides the meaning and actual content of the asset URI. Rust does not recognize game names such as bird, pig, or block, and does not add a sprite special case for one game.

## Consequences

- An old Scene that omits `size` still loads, using an explicit unit-size default.
- An invalid size returns `SCENE_SPRITE_INVALID` during Scene loading instead of letting the renderer produce unpredictable geometry.
- The observation includes the size declared by the Scene, so AI can compare the same state between headless execution and preview.
- A procedural quad is not evidence that a “real sprite asset is complete”; Angry Birds still needs separate validation of assets, hit feedback, UI, hot update, and cross-platform hosts.
- Decide whether to add engine primitives such as textures/atlases only after at least two validation games prove the shared need.
