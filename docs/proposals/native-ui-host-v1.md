# Native UI host — feasibility, not scheduled

> Merge reconciliation, 2026-09-14: this gap record was authored on the remote
> line without the local native UI/SVG commits `de32fe8` and `a587bf3`. Its
> missing-adapter and missing-font statements below are historical, superseded
> by [the implemented UI contract](../formal-ui-host.md) and
> [Windows SDK/SVG evidence](../reviews/2026-09-10-svg-sdk.md). No new renderer
> is being authorized or implemented by this merge. Android/iOS UI device
> validation and broader whole-game presentation acceptance remain open.

**Status: gap record. Needs re-confirmation before any implementation.**
Do not start coding, do not drop `ui` from native `runtime_blocked_systems`,
and do not replace the Web DOM host while this document is unconfirmed.

The UI *transport* already exists (`api.ui.setRoot` → `WorldSnapshot.ui`,
[ADR 0021](../decisions/0021-minimal-ui-tree-boundary.md)). What is missing is a
**native draw adapter**. Web already has one (DOM). This is a host swap later,
not a new UI language.

## Confirmed gaps (facts)

| Gap | Where it fails today | What still works |
|---|---|---|
| Native wgpu does not draw UI | `crates/unone-native-player/src/lib.rs`: any `snapshot.ui` → `NATIVE_PRESENTATION_UNSUPPORTED` | Tree is still in the snapshot for tests / AI |
| Catalog names the block | `hosts.rs` native `runtime_blocked_systems` includes `ui` | `sdk inspect --json` |
| Web draw is DOM, not mesh | `web/shared/ui-tree.js` | Shipping Web / WebView player |
| Native has no font path | no glyph/atlas code in `unone-native-player` | Images could reuse PNG decoders |
| JNI Canvas Android host is not this | `platform/android` smoke Canvas | Ignore for this gap |
| iOS host absent | roadmap 19 | Unrelated |

Roadmap already listed this as [platform gap 16](../roadmap.md). WebView APK is
**not** native UI; it embeds the Web DOM player.

## Intended replacement (when confirmed)

Same `unone.ui.v1` tree. Native wgpu: screen-space quads + rasterized text after
the 3D pass. Web: keep DOM (`createUiTree`). No pixel parity. Button `action`
strings stay host-mapped the way Web already does (`data-action` →
`input.queueAction`).

Not in Core: CSS engine, HTML converter, Vue/React, world-space diegetic UI,
IME/text fields.

## Must re-confirm before impl

These are product choices, not implied by the tree contract:

1. **Font:** project-declared font asset (fail `NATIVE_FONT_REQUIRED`) vs OS font.
   CJK is required for current games; a Latin-only lab is not enough evidence.
2. **Overflow:** clip to `rect` vs ellipsis. Pick one and test it.
3. **Hit order:** overlapping buttons; last child on top is the likely Web-like
   rule — lock with a test, do not guess in the player.
4. **Evidence games:** AVG / slot / a HUD lab. Roadmap said native UI backend
   needs AVG/RTS evidence; do not promote catalog support from a single lab.
5. **Web mesh UI:** still **out** unless DOM is measured as the bottleneck and
   accessibility is solved. This gap is native draw, not “make Web look native”.
6. **Catalog:** only remove `ui` from `runtime_blocked_systems` after clicks work
   on Windows native; Android is a follow-up with `device_evidence`.

## Impl sketch (do not execute yet)

After confirmation, replace the fail in `unone-native-player` with an
orthographic UI pass (`ui.rs` + `render.rs`), add `_Games/ui-native-lab`, then
update `hosts.rs` / `docs/portable-sdk.md`. Detailed checkbox tasks lived in an
earlier draft and are deliberately **not** an agent execution queue.

Likely files when someone does impl: `crates/unone-native-player/src/ui.rs`
(new), `render.rs`, `lib.rs`, `crates/unone-cli/src/hosts.rs`, a lab game,
docs only after evidence.

## Explicitly will not do in that impl

- Change `api.ui.setRoot` schema to get native drawing.
- Teach native to ingest HTML/CSS.
- Implement UI on the Java Canvas smoke host.
- Claim digest/visual identity with Web.
