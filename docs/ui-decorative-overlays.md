# Transient decorative UI overlays

Use `kit.imageBatch({id=...,rect=...,quads=...,decorative_overlay=true})` for transient image-only artwork that intentionally crosses HUDs, text and ordinary modal surfaces, such as resource fly-ins or celebration particles. Retained `content` instances support the same declaration. Default is false; the value must be boolean, not null.

This is a reusable presentation annotation, not game logic, a z-index or an input layer. Publish ordinary content first, the effect batch next, and any transition/loading curtain last. Existing authored order, clipping, quad opacity and tint, budgets and asset validation are unchanged. The flag never moves a node or changes pointer routing. The game owns receipt acceptance, lifetime, movement and the transition policy.

Only `image_batch` accepts the flag. It has no actions, text or interactive children. Combining true with `background_for` is rejected. Interactive/text nodes cannot claim this declaration, and collisions between ordinary foreground controls remain errors. Scroll-local image batches remain unsupported.

Strict layout inspection reports each declaration under `declared_overlays` with its actual node ordinal, overlapping-pair count and bounded examples. It permits intentional overlaps with the declared effect, including a later transition curtain, and keeps normal findings and work/evidence limits. This does not prove visual quality: verify the exported official player and input pass-through.

The Rust parser, canonical Luau typings, shared `@unone/ui` constructors and official Web image-batch reader share the declaration. Refresh the CLI, Web runtime and typings together when adopting it; older versions reject unknown props.
