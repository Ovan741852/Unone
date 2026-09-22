# Working-tree review and repair — 2026-09-22

Scope: pending Unone UI slice/budget, runtime diagnostics, native preview and
local tooling changes. Gameplay ownership stays in Luau. No release, installer,
mobile-device parity or commercial security certification is implied.

## Findings repaired

1. CLI preview normalized physical cursor positions using a capped render target.
   A 2560 x 1369 window could map its center to x=62.5 instead of 50. Store the
   physical window dimensions, use them for both pointer mappings/projection,
   and shrink capped render targets uniformly. Tests cover landscape, portrait,
   4K, uncapped windows and zero-size bounds.
2. CLI Bloom discovery confused the primitive renderer with the separate native
   player. Discovery identifies `cli-primitive-preview`, excludes Bloom from
   available operations, and returns `CAPABILITY_UNAVAILABLE` when requested.
   Relaunching the CLI is not a remedy. Documentation separates both hosts.
3. Removed game-name/id-dependent Rust debug colors; neutral primitive shading
   does not interpret NPC, monster, temple or other gameplay names.
4. Frame Atelier's prototype server allowed cross-origin unauthenticated writes
   and served the projects directory. It now enforces loopback Host, Origin/fetch
   metadata, per-run bearer authentication, bounded JSON/command queues, and an
   explicit static-resource allowlist. The browser and CLI bootstrap contract
   are updated together. Timed-out operations are never automatically replayed;
   an uncertain execution is reported explicitly.
5. PNG decoding now honors the same premultiplied RGBA contract as SVG, handles
   grayscale variants, and bounds decoded output. A generated-PNG regression
   checks four color modes, including partial alpha.
6. Execution-pair fingerprints include embedded JSON and Luau assets, not only
   Rust sources. A fixture proves changing either embedded contract changes the
   fingerprint.
7. Fixed strict Clippy failures without globally disabling warnings. Changes
   include idiomatic validation, moving test modules after production items,
   naming the export tuple and boxing internal plugin diagnostics. No gameplay
   rule or public protocol was changed by these lint repairs.

## Verification on Windows

| Gate | Result |
| --- | --- |
| `cargo clippy --workspace --all-targets -j2 -- -D warnings` | Pass, zero warnings |
| `cargo test --workspace -j2` | Pass; 362 passed, 3 explicitly ignored |
| Colocated tracked Web/script tests plus new UI/mode tests | Pass; 66 passed, 2 skipped, before the additional fingerprint test |
| `node --test scripts/verify-runtime-modes.test.mjs` | 5 passed, including the fingerprint regression |
| `node scripts/sync-ui-contract.mjs --check` | UI contract v2 matches |
| `npm test --prefix packages/scout` | 5 passed |
| `npm test --prefix plugins/org.unone.ai-native` | 46 passed |
| Native player library tests | 19 passed, 1 GPU test initially ignored |
| Explicit native GPU UI test | 1 passed (PNG, CJK, transparent button surface) |
| `python scripts/test_frame_atelier.py` | 5 real-HTTP tests passed |
| Actual Edge Frame Atelier bridge | Authenticated inspect/add/update, visible name, reload persistence and negative authorization controls passed; no model calls |
| Actual Edge DOM nine-slice pixels | 8 PNG/SVG x DPR 1/2 x landscape/portrait cases passed |

Evidence retained outside the repository under
`C:/Users/liNao/AppData/Local/UnoneBuildCache/`:

- `review-20260922-atelier/report.json` and `bridge-roundtrip.png`.
- `review-20260922-ui-dom/dom-report.json` and captured images.
- `review-20260922-web-tests.log`.

The existing [UI feature evidence](../evidence/2026-09-20-ui-slice-and-budget.md)
records the original game migration and release raster benchmark. These are
historical measurements, not a fresh release-performance claim for this review.

## Boundaries and retained work

Frame Atelier remains a local prototype requiring the sibling UnoneUI checkout;
its optional assistant on port 8787 is a separate service. Loopback authentication
protects against other websites, not a malicious local OS user. Browser tests use
an isolated profile and ephemeral server; no user project state was modified.

Android/iOS/macOS were not tested in this review. Large Wuxia prototype assets,
blind-layout experiments and unverified Particle Lab UI changes are not included
in this engine repair submission. Historical audit records are evidence of their
declared versions only, not fresh badges for the modified engine.
