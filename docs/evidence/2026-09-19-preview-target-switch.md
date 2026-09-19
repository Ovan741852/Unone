# Web / Windows Native target switch acceptance

Date: 2026-09-19. Status: Core, Windows GPU, manager, complete Viewer
Web ↔ Windows UI and BlueStacks Web regression accepted.
This is source/artifact acceptance, not an installed or published Viewer release.

## Scope and ownership

Reusable development tooling, not gameplay. The same Luau, scene and declared
assets are synchronized and exported by Core. The Viewer calls Core and owns
the local child process. Mobile keeps its Web preview; this is not Windows
desktop streaming and does not add an iOS native host.

Implementation plan: [work package](../work-packages/2026-09-19-preview-target-switch.md).
Public contract: [project prepare](../project-prepare.md).

## Reproducible fixture

`tests/preview-target-project` contains one moving SVG sprite, two stationary
SVG sprites, an orthographic unified Camera, and a deterministic 60-frame test.
The fixture explicitly disables unsupported or unused optional systems. It
does not weaken a real game's settings to make a native export pass.

`scripts/verify-project-prepare.mjs` copies it into a new evidence directory,
uses a real release SDK, saves every result, and checks old output fingerprints.
`scripts/verify-native-readiness.mjs` runs the actual native GPU and its negative
controls. Both require a new output directory so evidence is not overwritten.

## Core release integration

Evidence root on this machine:
`C:/Users/liNao/AppData/Local/UnoneBuildCache/preview-switch-evidence-20260919`.
Accepted SDK: `sdk-shared`. Detailed machine results: `core-shared/result.json`
and its per-case JSON files. Earlier failed evidence directories are retained.

| Case | Result | Wall time |
| --- | --- | --- |
| Web preflight, project fingerprint unchanged | compatible | 330 ms |
| Windows preflight, project fingerprint unchanged | compatible | 276 ms |
| Web sync, verify and export | ready | 535 ms |
| Windows sync, verify and export | ready | 442 ms |
| Existing output | rejected, old output unchanged | 135 ms |
| Missing runtime | rejected before project mutation | 246 ms |
| SDK executable path too deep | rejected before mutation, concrete recovery | 570 ms |
| Unsupported target | CLI usage error, no output | 106 ms |
| Unsupported native Spine system | explicit incompatibility, read-only | 259 ms |
| Deliberately failing test | sync_failed, nonzero exit, no new export | 288 ms |

These are one warm local sample, **not** a performance guarantee for large
projects. Preparing uses precompiled runtimes; building the runtime itself is
separate and can take minutes. No gameplay-state migration between hosts is
claimed.

CLI SHA-256: `2712e8d8acd97f9fe903e69cc4ec5e003fbf4660d51caeb4f680cc55f151341d`.
Windows runtime SHA-256: `d90a521d1d486ce1d5cb5f5e9d8c84d329aa4cd3d1efec76ee8ca29891ef82d6`.
Web WASM SHA-256: `2605827b21a28619507232cf6351078db35b77be050850fd4b0017bf9d5a3d1e`.
Web JS SHA-256: `4f6ddb1170dcb426f060aad4b6773e738a56e990a1feb54dc8f1b38fc31d2d1e`.
Source HEAD: `950d35f1474432221a4ba18a3588ba351ce6bf59`, dirty worktree;
these hashes identify the actual built artifacts, not a published release.

The implementer's final CLI unit suite passed 54 tests; native unit suite passed
18 with 1 explicitly ignored. Parent-owned real-SDK acceptance above is
independent of those unit fixtures. This native release artifact reports
`native_codegen_compiled:false`; this is not native-codegen speed certification.

## Actual native first-frame evidence

`native-ready-shared/result.json`, `gpu.json`, `gpu.png` and logs:

- Windows RTX 5080 / Vulkan rendered 3 frames and emitted exactly one
  `unone.native-ready.v1` record with the matching package hash and child PID.
- Headless execution emitted no render-ready record.
- Missing package exited with code 2 and emitted no render-ready record.
- Parent visually inspected the GPU PNG; all three SVG sprites were present.

## Actual manager lifecycle

`Koncrate-Editor/scripts/verify-unone-preview-targets.mjs` uses the real trusted
SDK, plugin-owned manager, Web WASM and native GPU. `manager-shared/result.json`
passed eight checks:

| Operation | Outcome | Wall time |
| --- | --- | --- |
| Start Web | real frames, static preview ready | 771 ms |
| Denied native request | previous Web remains ready | 17 ms |
| Web → Windows | matching first-frame receipt, old Web closed | 2647 ms |
| Start same target | same generation/PID, no duplicate | <1 ms |
| Windows → Web | native PID exits, Web renders | 840 ms |
| Restart Web | new generation and URL, previous URL closed | 672 ms |
| Stop Web | idle, URL closed | 2 ms |
| Deep standalone executable | concrete path error, exit 2 | 138 ms |

Native capture: `manager-shared/native-capture.png`, visually inspected by the
parent; three SVG sprites rendered. The canonical shared executable path was
195 characters, data root 250, and standalone exported executable 278. The
ready receipt binds package hash, actual child PID and renderer/adapter.
Timings are one small warm local fixture, not comparative benchmarks.

## Integration findings caught before acceptance

- Pretty multiline Core JSON must be parsed as one result, not its last line.
- The bundled SDK CLI must be used; an unrelated debug CLI fails SDK identity.
- Windows extended/canonical paths need filesystem identity checks, not raw
  string comparisons. Long-path execution must also retain Windows support.
- Actual GPU adapter descriptions exceed 200 characters; they must not be
  rejected by an invented, narrower readiness contract.
- Trusted prepare receipts add `sdk_selection` metadata beyond export.json.
  Hash checks must compare equivalent fields and bind to the trusted receipt,
  not trust a project-writable executable and manifest merely agreeing.

## Explicit boundaries

Native Spine/Effekseer and HTML-only presentation limitations remain visible
compatibility gates. Android emulator coverage is Web preview regression, not
proof of Android native parity. Background/color differences between existing
Web and native renderers are outside this switch change and are not certified
away by successful startup. No iOS device or physical phone claim is made.

## Viewer acceptance (parent-owned)

`Koncrate-Editor/scripts/verify-unone-preview-ui.mjs` starts real Viewer HTTP,
Workshop authorization, the Unone adapter, real Core SDK, and real Web WASM.
Only the account/provider/network identity is synthetic; no production login,
setting, project, or existing preview is changed.

`ui-shared/result.json`: seven checks passed, zero browser exceptions:

- One local entry and explicit execution grant; static sharing does not grant execution.
- Web prepare/start, visible rendering and advancing simulation frames.
- Five-second background refresh preserves the selected next target.
- Actual UI Web → Windows → Web, including a real native GPU ready receipt.
- 1280, 390 and 320 pixel layouts; controls at least 44 px, no horizontal overflow.
  Escape returns focus to the entry and polling does not reopen the dialog.
- Restart creates a new generation; stop/cancel/revoke leave the manager idle.
- Remote UI has no local-native entry; the actual remote HTTP request returns 403.

Parent reviewed desktop/320px/remote390px screenshots after one correction pass.
The interface skill influenced use of one structured dialog, removal of a
redundant current-target button, and the 320px tab-width correction. The detector
ran once; its new local error-side-border finding was corrected, while the
unrelated existing activity-page styling was left unchanged.

Final Viewer `npm test`: **438 tests, 420 passed, 18 skipped, 0 failed** (34.2 s).
Separate Unone plugin invocation/parser tests: **3 passed, 0 failed**.
Skips are explicitly labeled existing unavailable-volume/symlink-specific cases;
the new Windows junction scope-escape test actually ran and passed.

## Actual BlueStacks Android TEST App

`Koncrate-Editor/scripts/verify-android-web-preview.mjs` built and installed only
`dev.koncrate.viewer.test` on BlueStacks `127.0.0.1:5555`. Both official package
paths were checked unchanged. Accepted report:
`C:/Users/liNao/AppData/Local/KoncrateBuild/preview-switch-evidence-20260919/android-web-preview-ui-v8/report.json`.

- Synthetic account → selected project → actual PlayerActivity and Web WASM.
- Three SVG sprites visible in the actual device screenshot, independently
  inspected by the parent. Frame advanced **4 → 18**; a same-frame WebGL sample
  contained 1024 nonzero pixels. Native load state alone was not counted as proof.
- Native exit control visible; `app.close_preview` returned to the same project.
- Test share disabled, active remote previews became zero. This stop action was
  a synthetic lab hook, not a new mobile authority to disable arbitrary hosts.
- Mobile exposes no unsupported Windows Native option.

APK SHA-256: `a41b4bc45467402c62ee6a70793f6415146bb4a9ff359b46258b4ebe3192152d`.
All **55** source fingerprints in its build receipt matched the final source.
Bundled prebuilt mobile FFI SHA-256:
`845a580f3a646f836e1d886581454e58d2f55dad01850e30324f8c82c7e72901`.
That FFI was not rebuilt to certify the current Android native renderer.
Web export JSON SHA-256:
`43d840767e9332f95142b0abde43c3a2cf9f784b5a223cc0b6b768eadf3f9031`.
This is a real Web rendering regression over emulator `10.0.2.2`, not real
accounts, Tailscale/WAN, physical phones or Android native graphics validation.

Saved screenshots: `workspace-projects.png`, `workspace-project.png`,
`web-preview-player.png`, `workspace-returned.png` in the v8 evidence directory.

Findings corrected rather than hiding failures:

- Android package and WebView allowlist omitted current app imports. Both were
  fixed; build-time import-closure checks now reject missing packaged/served files.
- Test discovery used the wrong asset origin and first WebView page. It now uses
  the actual appassets origin and all pages within observed WebView contexts.
- WebGL buffers may be discarded after presentation; arbitrary-time readPixels
  falsely classified a rendered screen as blank. Sampling now runs inside an
  animation frame, while retaining both nonblank and frame-advance assertions.
- Stale APK fixture endpoints are rejected; failure screenshots are retained.
  Earlier v1–v7 failures remain historical evidence, not passing runs.
- An early missing-export negative control (`android-web-preview-negative-catch-v1`)
  preserves the original ENOENT error and `ok:false` before any device mutation;
  absent WebView handles no longer crash the failure reporter. Reused APK checks
  bind the fixture pairing code as well as both endpoints.

## Windows long-path finding and final architecture

Real tests exposed Windows runtime failure only after filesystem identity
resolution expands an AppData alias into a long MSIX-cache path. The first
failure was unsupported file-drop OLE registration; disabling an unused input
contract removed that panic but did not fix the separate GPU startup fast-fail.
The standard `longPathAware` application manifest was embedded and inspected,
but the historical `parent-manager-longpath/result.json` still records exit
`3221226505` before renderer-ready, with empty stderr. Stage probes localized
failure to graphics initialization; exact driver/module responsibility is not
confirmed by a crash dump. The same binary with a shallow executable path and
deep project data/cwd worked. Diagnostic probes were removed before acceptance.

Final contract separates a hash-verified **trusted SDK program** from project
generation **data**. It does not create hidden path aliases or force another
GPU backend. Core preflight rejects a Windows SDK executable at/over 260 UTF-16
code units. Standalone GUI also rejects this condition with
`NATIVE_EXECUTABLE_PATH_TOO_LONG`; headless and describe remain usable.
SDK scope, descriptor/runtime bytes, Core receipt and on-disk export metadata
are checked. Project-writable executable/manifest agreement alone is not trust.

The accepted shared-SDK manager and UI runs above both exercise the corrected
launch design. An arbitrarily deep standalone executable is **not** declared
GPU-compatible; callers get the explicit installation recovery instead.

## Remaining scope / delivery

- Generations currently accumulate: measured approximately 18.06 MiB per native
  generation and 4.38 MiB per Web generation. Bounded host-owned retention is a
  follow-up, not an implemented automatic cleaner; no user files were deleted.
- Live runtimes (including failed candidate cleanup) keep the maintenance gate
  occupied until actual close; timeout does not falsely declare an idle host.
- Unone-specific lifecycle logic lives in the Unone plugin, not generic host.
- No commit, push, deployment or official desktop Viewer replacement was done
  as part of this acceptance. Existing unrelated worktree edits remain intact.
