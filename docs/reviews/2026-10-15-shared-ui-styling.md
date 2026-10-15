# Shared official UI typography, styling and discovery

Date: 2026-10-15. Baseline: `0027ce408580b68b2578fb73aa239179d31b186e` on `main`.

## Result and ownership

The existing official UI tree lacked portable typography and box controls, so
moving a game into the official player lost its intended hierarchy and spacing.
Optional typed leaf styles now express font family/size/weight, alignment,
tracking, wrapping, padding, colors, borders, radius and group opacity. A
decorative panel composes with existing controls and component trees. The old
unstyled behavior remains compatible; explicit sizes never shrink to fit.

Core validates and publishes presentation data atomically. Web/native hosts own
font resources and painting. Font catalogs use named TTF/OTF faces and weights.
Read-only viewport aspect supports game-authored responsive compositions. Themes,
cards, status bars, screen flow and placement stay in Luau. The Voidwake source
example under `_Games/voidwake` uses these APIs, the official player, existing
ImageGen PNGs, declarative particles and engine-owned sprite shaders. No engine
branch refers to its screen IDs, artwork, colors or business rules.

API descriptions, strict Luau types, schema, English/Chinese intent searches and
current authoring guides point to the same contract. Mixed queries such as
`共用UI元件`, explicit fields such as `font_size`, and exact API names have
CLI/MCP regressions. Invalid combinations explain the supported contract without
silently replacing the previously valid tree.

## Validation and practical limits

- Release workspace tests and strict workspace Clippy passed after final Rust
  changes. This includes style validation/atomic state, generated schema/types,
  font limits, export metadata and CLI/MCP search contracts.
- Native UI: 24 tests passed, with one existing optional GPU test ignored. CPU
  raster tests exercise packaged aliases/weights, explicit font size, alignment,
  wrapping, rounded borders, opacity and invalid fonts. This is not a claim of
  native GPU game acceptance or identical native/browser font pixels.
- Web: style and existing Canvas unit tests passed. Eighteen real-browser cases
  exercise font loading, weights, DPR 1/2, landscape/portrait, Canvas/DOM adapter
  pixel agreement, wrapping/ellipsis, rounded boxes, group opacity, decorative
  input passthrough and malformed-font rejection. Tracking tests include Latin,
  CJK, a single glyph and an emoji grapheme. Existing nine-slice DOM checks pass.
- Voidwake: seven aggregate gates pass, including types, assets, four strict UI
  previews and ten deterministic replay cases. Intentional overlaps name only
  reviewed decorative backgrounds; text/control collisions are not waived.
  The exported player matches native observation digests for all ten cases.
  Actual official-player browser checks cover launch, movement, firing, camera
  pointer reprojection, abilities, pause, audio, shader/particle drawing and no
  browser/compiler errors. The narrow-screen menu, flight HUD and pause screen
  were also inspected in the in-app browser at 390 by 844.

Compact results are in [acceptance.json](../evidence/2026-10-15-ui-styling/acceptance.json).
Build products, full logs and screenshots remain under ignored `artifacts/` and
the local game evidence directory. The portable source example exports using
the normal bundle/export APIs; generated bundles and player runtimes are ignored.

## Independent review

Independent agents reviewed Core validation/schema/types, native/Web rendering,
font packaging, API discovery and current guidance. Confirmed corrections include
fallback family quoting, first-catalog default selection, native font aliases and
weights, whole-line shaping, mixed Latin/CJK wrapping and trailing tracking
measurement. Canvas includes a final tracking advance in `measureText`; the shared
measurement helper now removes that advance while retaining whole-line shaping.
Independent pixel and text regressions cover these corrections.

The prescribed Claude CLI review was attempted using version `2.1.280`, tools
disabled, a supplied fixed staged diff and plan permissions. It produced no
stdout or stderr before the 150-second timeout (exit 124). **This was not a
completed Claude review.** The exact command, baseline and supplied diff SHA-256
are preserved in [attempt metadata](../evidence/2026-10-15-ui-styling/claude-attempt.json).
Later tracking, search, diagnostic-text and game-source corrections are outside
that incomplete snapshot. The independent reviews and executable checks above
are separate evidence, not a replacement claim about Claude's result.
