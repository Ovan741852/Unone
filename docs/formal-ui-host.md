# Formal UI host contract

Ownership: Core supplies the reusable resolved UI tree, semantic input and layout diagnostics. Host adapters render and route input. Game Luau owns screens, transitions, actions, artwork and gameplay. No viewer/editor service is required. MVVM remains optional.

## Portable presentation

Since UI contract v2 (2026-09-20), all three projections (Canvas, developer DOM,
native) support one-image/one-node nine-slice. The fixed 256-node gate is replaced
by a shared configurable budget. See [authoring, diagnostics and verification](ui-slice-and-budget.md).
Native CPU-rasterizes each changed leaf into its own GPU atlas tile; a larger
capacity is not a guarantee that thousands of changing panels redraw at 60 FPS.

The official Web player draws text, buttons, image skins, semantic controls,
decorative panels, image batches and nested `component` leaves with three.js in
the render pipeline's `ui` stage, inside the same WebGL frame as the world
(`web/renderer/ui-gpu.js`). One instanced quad shader draws rounded fills,
borders, images, nine-slices and image batches in painter order; a draw call
ends only where the texture changes. The browser font engine rasterizes each
text block once into an atlas page and only changed blocks are uploaded; the
geometry is rebuilt only when the composition changes. Leaf `opacity` multiplies
each of the leaf's quads rather than compositing the leaf offscreen.
`web/shared/canvas-ui.mjs` owns layout, validation, pointer routing, assets and
diagnostics for that pass, and still paints Canvas2D for tool and preview hosts
that pass it a 2D canvas. It creates no DOM game controls. Native rasterizes each
supported leaf into its own tile of a GPU atlas, only when that leaf or the
surface size changes, and wgpu draws the tiles in leaf order after the world
with one instanced call per texture; a changing label re-rasterizes one tile. Rectangles are resolved
screen coordinates, 0–100, y-up; component wrappers do not transform them again.
The [shared typography and box style contract](ui-styling.md) extends these
existing leaves; game/SDK component functions remain the composition boundary.

Portable artwork includes PNG and the native static SVG subset. Native accepts
`.svg` shapes, paths, gradients, internal references, masks/clips and inline
presentation attributes at the current surface resolution. Script, animation,
foreignObject, nested images, stylesheet elements and external references fail
with an asset/source-specific diagnostic. SVG is limited to 8 MiB and 10000 XML
nodes; it is not complete browser SVG/CSS. JPEG/WebP UI images need PNG companions.
Image fit supports contain, cover and stretch. Existing buttons can now paint a
typed background/border as well as text; image skins and nine-slice still compose
beside semantic controls. The SDK checks the selected runtime's image capability
declaration before allowing native SVG export.

Both hosts route pointer actions to interactive rectangles in reverse leaf order.
Text, image and decorative panel leaves pass through to a button/combobox behind
them; without an interactive hit they do not capture world input. Hit regions
are rectangular, including transparent or rounded corners, rather than
alpha-aware. Captured release/movement cannot fall through after a screen
transition. Semantic down/up edges survive taps between frames, and multiple
pointers holding one action release it only after the final release. Native
world pointer mapping follows Web Camera2D; game-specific 3D ground-plane raycasts
remain gameplay policy. Scroll content has its separate Web routing contract.

Native limits: camera3d is still required by the existing world renderer; audio/effect event presentation and whole-game/mobile UI acceptance are separate work. The native surface clamps to 8192 pixels per edge and the device texture limit. It rerasterizes/uploads only when tree or size changes, but a changing full-screen UI can be expensive: native reports `ui_raster` CPU time and upload bytes. These are not GPU timing or leak proofs.

## Fonts

Hosts use installed fonts by default; glyph availability and exact metrics can
differ. Declare licensed project fonts in `player.presentation.json` (exported
as `content/presentation.json`):

```json
{"ui":{"font_family":"Game UI","fonts":[{"family":"Game UI","source":"fonts/body.ttf","weight":400},{"family":"Game UI","source":"fonts/semibold.ttf","weight":600}]}}
```

Export copies declared TTF/OTF files; Web waits for FontFace loading and native
registers the same family/weight aliases in its font database. Catalog family
names can differ from internal metadata. The older `font_source` declaration
remains supported; native reports unsupported font formats explicitly. Styled
leaves have explicit font size, weight, line height, spacing, color, alignment,
wrapping and clipping/ellipsis controls. A fixed size never shrinks to fit.
Unstyled leaves retain legacy fitting behavior. Font rights belong to the
project, and glyph fallback/rasterizer differences still require target visual
acceptance. See [defaults, limits and examples](ui-styling.md).

## Intentional art overlaps without disabling strict checks

For reusable component backgrounds, declare intent inside the Luau function that
returns the existing component tree. An earlier `image` or `panel` leaf may have
`background_for={component="ancestor_id"}`; the ID must name an actual component
ancestor in the same coordinate space. `background_for={screen=true}` instead
declares a background in screen coordinates. Exactly one scope is required, and
the background rectangle must fit that scope. A component name, sibling ID,
unrelated component or cross-scroll ancestor cannot stand in for that scope.

Strict inspection exempts only later descendants of the declared scope whose
entire rectangles fit within the background. Foreground collisions, partial
coverage, siblings outside a component scope and later backgrounds occluding
earlier leaves still produce findings. Scope metadata changes neither rendering
order nor input, placement, clipping or style inheritance. See the
[reusable card example](ui-styling.md#reuse-existing-components).
Accepted scoped pairs are summarized in `declared_backgrounds`, one group per
actual authored background leaf and declared scope owner. Each group exposes
`background`, its zero-based `background_node_index` in report `nodes`, the typed
`scope`, the full `pair_count`, and at most two later leaf ID `examples`. Every
counted pair still passes the same paint-order, scope and rectangle-containment
checks; aggregation changes diagnostic output only. Reusing a component type or
retained artwork resource does not merge distinct authored backgrounds.

The declaration travels with each component instance, so ordinary card
backgrounds do not require an external policy naming every internal leaf.
Version-1 exact-pair policies remain supported for deliberately layered artwork,
including slider skins that do not meet scoped containment.
`game ui preview --strict --overlap-policy policy.json` accepts those exact ordered pairs:

```json
{"version":1,"screens":{"menu":[{"behind":"start_art","front":"start_button","reason":"PNG artwork beneath transparent input target"}]}}
```

MCP `unone_ui_preview` accepts the same object as `overlap_policy`. The screen key
is the root UI ID. Only an existing overlapping pair with an earlier image or
decorative panel behind the foreground node is waived. Missing/stale pairs,
reversed order, empty reasons and unknown fields fail. Text/button and
button/button collisions cannot be waived by this artwork policy. Approved pairs
remain in `allowed_overlaps` as `UI_INTENTIONAL_ART_OVERLAP`; remaining findings
still determine readability. A panel's background is not a reason to disable
unrelated overlap checks.

Declared-background groups and exact-pair policy records share one bounded
evidence budget: `declared_backgrounds.length + allowed_overlaps.length` cannot
exceed `max_layout_findings` from the UI contract. A group's `pair_count` does not
consume another output record for each checked descendant. Findings retain their
independent limit, and every pair still counts toward `max_layout_comparisons`;
there is no subtree or geometry-check exemption.
Exceeding it returns `UI_LAYOUT_WORK_LIMIT`; it cannot turn an incomplete
inspection into a pass. Repeated ordered policy pairs produce one entry using
the first reason; every supplied reason must still be nonempty. A policy error
leaves the report unchanged. Remove old exact pairs that a typed declaration
already covers: they are stale rather than a second approval of the same pair.

## Build and acceptance

Use matching CLI and host templates. Missing export templates now report `PLAYER_TEMPLATE_MISSING` with the actual path. The parity wrapper runs its child from the tool repository, not the game's working directory. Long clean builds can use `verify-player-parity.mjs --timeout-ms 600000` or `build-web-live.ps1 -ParityTimeoutMs 600000`. Timeout/signal failures retain structured process evidence even when output is empty.

Verified on 2026-09-10: Canvas router/render unit tests; CLI and strict-layout tests; native input unit tests; explicit real-GPU PNG alpha/CJK/transparent-button overlay smoke. The GPU smoke is intentionally opt-in (`cargo test --manifest-path crates/unone-native-player/Cargo.toml --lib gpu_png_cjk -- --ignored --nocapture`).

YesSir reports nine strict-layout screens, three browser sizes with real pointer interaction, and 19 native/WASM logic parity cases passing. Its game-specific evidence stays in its repository (`tests/formal-layout`, `tests/formal-ui-browser.json`, `FORMAL-UI.md`). Logic parity and this renderer smoke do not certify native whole-game presentation or mobile performance.

Final Claude source review found no actionable blocker/high defects after the texture-limit, world-pointer and lifecycle fixes. Root `cargo test --workspace`, standalone native unit tests, explicit native GPU smoke, and six Node adapter/process tests passed. Windows release runtime was handed to YesSir at `target/formal-ui-native-runtime-v2`; executable SHA-256: `fe266f06d8e6a9618c41584804f83cda6187e67ee8a8ee32468699e3420456c3` (built from the working changes, not a clean released SDK).

YesSir's reported improvement: one Luau semantic UI tree now connects the official renderer, held actions and auditable strict layout, replacing separate DOM controls/hit testing. Remaining largest friction: assembling a compatible CLI/runtime/templates/plugin set. Exact-path export errors and deterministic wrapper cwd help, but an integrated source/version/hash/capability resolver and published verified combinations remain future work.

Follow-up SVG/SDK testing, including the native presentation-file packaging fix, is recorded in [the compatibility ledger](reviews/2026-09-10-svg-sdk.md). Prefer that ledger over rerunning the earlier PNG-only acceptance or treating its runtime as SVG-capable.
