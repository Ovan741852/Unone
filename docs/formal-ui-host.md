# Formal UI host contract

Ownership: Core supplies the reusable resolved UI tree, semantic input and layout diagnostics. Host adapters render and route input. Game Luau owns screens, transitions, actions, artwork and gameplay. No viewer/editor service is required. MVVM remains optional.

## Portable presentation

`web/shared/canvas-ui.mjs` renders `text`, `image`, transparent `button`, and nested `component` leaves into one Canvas2D surface. It creates no DOM game controls. The native player draws the same leaves into a CPU-rasterized texture composited by wgpu after the world. Rectangles are resolved screen coordinates, 0–100, y-up; component wrappers do not transform them again.

Portable artwork includes PNG and the native static SVG subset. Native now accepts `.svg` shapes, paths, gradients, internal references, masks/clips and inline presentation attributes; it renders at the current surface resolution. Script, animation, foreignObject, nested images, stylesheet elements and external references fail with an asset/source-specific diagnostic. SVG is limited to 8 MiB and 10000 XML nodes. This is not complete browser SVG/CSS compatibility. JPEG/WebP still need PNG companions; 3D mesh textures remain PNG-only. Image fit supports contain, cover and stretch. Buttons draw text only: use a preceding image leaf for artwork. The SDK checks the selected runtime's `ui.images: ["png", "svg-static"]` declaration before allowing SVG native export.

Both hosts hit-test rectangles in reverse leaf order. Image/text leaves shield the world too; transparent pixels still block within their rectangle. This is not alpha-aware hit testing. Keep ornamental rectangles tight. Captured pointer release/movement cannot fall through after a screen transition. Semantic down/up edges survive taps between frames, and multiple pointers holding one action release it only after the final pointer releases. Native world pointer mapping follows Web Camera2D; game-specific 3D ground-plane raycasts remain gameplay policy.

Native limits: camera3d is still required by the existing world renderer; audio/effect event presentation and whole-game/mobile UI acceptance are separate work. The native surface clamps to 8192 pixels per edge and the device texture limit. It rerasterizes/uploads only when tree or size changes, but a changing full-screen UI can be expensive: native reports `ui_raster` CPU time and upload bytes. These are not GPU timing or leak proofs.

## Fonts

Hosts use installed fonts by default; glyph availability and exact text metrics differ. For a licensed project font, set the project's `player.presentation.json` (exported as `content/presentation.json`):

```json
{"ui":{"font_source":"fonts/game.ttf","font_family":"Game UI"}}
```

Export copies the file into the content package. Web registers a FontFace; native loads it into its font database. The family must match the font's family name. Font redistribution rights belong to the project. Web shrinks text to fit width/height; native sizes by height and clips overflow, so text layout still requires visual acceptance on each target.

## Intentional art overlaps without disabling strict checks

`game ui preview --strict --overlap-policy policy.json` accepts exact ordered pairs:

```json
{"version":1,"screens":{"menu":[{"behind":"start_art","front":"start_button","reason":"PNG artwork beneath transparent input target"}]}}
```

MCP `unone_ui_preview` accepts the same object as `overlap_policy`. The screen key is the root UI ID. Only an existing overlapping pair with an image behind the foreground node is waived. Missing/stale pairs, reversed order, empty reasons and unknown fields fail. Button–button overlap remains a failure. Approved pairs are retained in `allowed_overlaps` as `UI_INTENTIONAL_ART_OVERLAP`; remaining findings still determine readability.

## Build and acceptance

Use matching CLI and host templates. Missing export templates now report `PLAYER_TEMPLATE_MISSING` with the actual path. The parity wrapper runs its child from the tool repository, not the game's working directory. Long clean builds can use `verify-player-parity.mjs --timeout-ms 600000` or `build-web-live.ps1 -ParityTimeoutMs 600000`. Timeout/signal failures retain structured process evidence even when output is empty.

Verified on 2026-09-10: Canvas router/render unit tests; CLI and strict-layout tests; native input unit tests; explicit real-GPU PNG alpha/CJK/transparent-button overlay smoke. The GPU smoke is intentionally opt-in (`cargo test --manifest-path crates/unone-native-player/Cargo.toml --lib gpu_png_cjk -- --ignored --nocapture`).

YesSir reports nine strict-layout screens, three browser sizes with real pointer interaction, and 19 native/WASM logic parity cases passing. Its game-specific evidence stays in its repository (`tests/formal-layout`, `tests/formal-ui-browser.json`, `FORMAL-UI.md`). Logic parity and this renderer smoke do not certify native whole-game presentation or mobile performance.

Final Claude source review found no actionable blocker/high defects after the texture-limit, world-pointer and lifecycle fixes. Root `cargo test --workspace`, standalone native unit tests, explicit native GPU smoke, and six Node adapter/process tests passed. Windows release runtime was handed to YesSir at `target/formal-ui-native-runtime-v2`; executable SHA-256: `fe266f06d8e6a9618c41584804f83cda6187e67ee8a8ee32468699e3420456c3` (built from the working changes, not a clean released SDK).

YesSir's reported improvement: one Luau semantic UI tree now connects the official renderer, held actions and auditable strict layout, replacing separate DOM controls/hit testing. Remaining largest friction: assembling a compatible CLI/runtime/templates/plugin set. Exact-path export errors and deterministic wrapper cwd help, but an integrated source/version/hash/capability resolver and published verified combinations remain future work.

Follow-up SVG/SDK testing, including the native presentation-file packaging fix, is recorded in [the compatibility ledger](reviews/2026-09-10-svg-sdk.md). Prefer that ledger over rerunning the earlier PNG-only acceptance or treating its runtime as SVG-capable.
