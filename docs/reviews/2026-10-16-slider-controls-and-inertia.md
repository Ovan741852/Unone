# Official slider controls and optional scroll inertia

Date: 2026-10-16. Baseline: `c05af8b14b388ecf559b593aa8f7c5d541e9ce39`
on `main`; review covered the subsequent working tree. The accepted ownership
decision is [ADR 0042](../decisions/0042-official-slider-input-and-scroll-inertia.md).

## Shared contract and ownership

`@unone/ui` 0.3.0 supplies the persistent pure Luau
`ui.components.createSlider(options)` model on both the default module and themed
kit. The model owns min/max, optional min-relative step rounding, value and
interaction lifecycle. Both endpoints remain reachable. Projects retain models
by stable identity, call `control.update(api.input)` once per `Game.update`, and
use `getValue`, `setValue` or `cancel` for explicit application state changes.
The package introduces no callbacks, layout solver, artwork or implicit binding
to audio, saves or game rules.

`control.view(props)` is pure and emits the existing Slider node with declarative
drag geometry. Stage coordinates are y-up; scroll content uses local
top-left/y-down coordinates. Virtual materialization translates the leaf, track
and hit rectangles together. Official hosts own projected/clipped hit testing,
capture and axis/reverse mapping, and send finite normalized ratios with
`start`, `drag`, `end` or `cancel` phases through `InputFrame.ui_sliders`.
Queues preserve edges, coalesce adjacent motion and deliver at most one event
per control per tick. Core validates at most 256 controls and IDs of at most
1024 UTF-8 bytes, then exposes a fresh, non-consuming per-tick snapshot through
`input.getSliderInteraction(id)`. Pending events clear after a successful tick.
The legacy low-level `slider(props)` without drag metadata keeps pointer
passthrough and does not become a numeric controller.

Web scroll wrappers add opt-in host presentation motion: `inertia=false` remains
the default, and `deceleration=8` is a finite exponential decay rate in
`(0,100]` inverse seconds. Coast motion uses host time and an analytic integral,
stays clamped without elastic overscroll, and stops on the documented input,
lifecycle, bounds, configuration and geometry changes. It advances no physics
tick, `Game.update`, RNG or application state. Native slider routing is covered;
**native scroll views and scroll inertia remain explicitly unsupported**.
See the [slider contract](../ui-components.md#interactive-sliders) and
[scroll contract](../ui-scroll.md).

## Source review and corrected issues

An independent Codex agent performed bounded read-only source review across
the Luau model, Core input/snapshots, Web projection/capture/queues/inertia and
native adapters. It did not build or execute tests. The final checked source
identities are in the [source inventory](../evidence/2026-10-16-slider-controls-inertia/reviewed-source-inventory.json).

| Issue and reproduction | Correction and regression |
| --- | --- |
| A disabled scroll ancestor projected a model Slider to text but retained `drag`, so the canvas validator rejected an otherwise legal disabled collection. | Disabled projection removes both action and drag metadata. Web regressions render the collection and cancel an existing slider capture when its ancestor is disabled. |
| Default hit padding around a valid slider at stage or scroll-local `(0,0)` produced a negative hit rectangle that Core rejected. | Padded hit bounds may protrude and are clipped by the host; visible track bounds remain strict. All rectangle bounds and sums must be finite. Real `createSlider.view` publication tests cover both origins. |
| A model/raw interactive Slider accepted a 1025-byte ID, but its first host event failed the 1024-byte InputFrame limit. | The model and Core interactive-node parser enforce the same UTF-8 byte limit. Tests accept 1024 bytes and reject 1025 bytes before interaction. |
| An inner view continued coasting after an ancestor changed only its clip, leaving the inner rectangle and extent unchanged. | Momentum signatures include the inherited clip. A fake-clock regression shrinks an ancestor at the same top position and verifies scheduling and offsets stop. |
| Virtual row materialization initially translated only the leaf rectangle, leaving track/hit geometry at the first row. This was identified during package integration and independently rechecked. | `translated()` copies and moves both drag rectangles with the leaf. A real helper/Core regression checks later rows and preservation of the original props. |
| For a legal very small decay rate, `1-exp(-k*dt)` rounded to zero, producing stationary offsets while RAF continued. The main agent identified this numerical issue after the Claude attempt. | The analytic distance uses `dt * (-expm1(-exponent)/exponent)`, with the exact zero-exponent limit `dt`. A `Number.MIN_VALUE` fake-clock regression verifies continued motion; frame-rate comparisons remain separate coverage. |

All four independent findings were corrected and rechecked. Virtual translation
and the later numerical correction were also rechecked. No concrete finding
remained within this source scope; this conclusion does not establish browser
or device output.

## Executed validation and preserved failures

The main agent executed the validation commands; the evidence writer copied
their output and independently checked artifact hashes. Commands, environment,
results and scope are in
[validation.json](../evidence/2026-10-16-slider-controls-inertia/validation.json).

- Release workspace tests: **472 passed, 3 ignored**.
- Strict release workspace Clippy and the release CLI build passed.
- Native release library tests: **31 passed, 1 ignored**. This is router and
  library coverage, not native GUI/device acceptance.
- Final Web tests: **53 passed**, covering the canvas router, input queues,
  player route, scroll projection/controller and runtime-core integration.
- Normal project verify passed for Harbor Controls (5 gates), Observatory
  Settings (4 gates) and VOIDWAKE (7 gates). Each SDK `project prepare` returned
  a ready official Web export. Exported-player parity passed 9 compared Harbor
  frames and 10 VOIDWAKE frames; these are bounded runtime comparisons.

Earlier failures are retained under explicit names. The
[first workspace run](../evidence/2026-10-16-slider-controls-inertia/workspace-tests-initial-schema-failure.txt)
failed the checked-in developer schema freshness test before schema regeneration.
The [intermediate run](../evidence/2026-10-16-slider-controls-inertia/workspace-tests-intermediate-test-error.txt)
then failed the new ID rejection test because it passed a returned error object
directly to `string.find`; the assertion needed `tostring(message)`. Neither run
is counted as passing. The
[verified run](../evidence/2026-10-16-slider-controls-inertia/workspace-tests-verified.txt)
is separate. Initial example verify records also preserve the Harbor observation
type error and remaining legacy pointer-input fixtures; the subsequent normal
verify records passed after those migration corrections.

The SDK inventory, package/runtime version and source/template/export parity
records are preserved beside the logs. The initial portable SDK at
`D:/TSProject/UnoneSliderInertia-20261016/sdk` contained 66 inventoried files;
read-only SHA-256/length verification matched all 66. The final CLI descriptor
also names `createSlider` in the themed kit's discovery text. Its targeted API
ranking regression and rebuilt release CLI passed; this final change alters
descriptor text and leaves the host/runtime behavior unchanged.

The final repack at `D:/TSProject/UnoneSliderInertia-20261016/sdk-final` passed
pack and inspect. Independent read-only SHA-256/length verification again
matched **all 66 inventory files**; the
[final inventory](../evidence/2026-10-16-slider-controls-inertia/sdk-final-inventory-verification.json)
also records the final API source hash. Final-SDK Harbor preparation passed its
five gates and produced exactly the same `c303...` release as the browser-tested
export, as recorded in
[final SDK/export parity](../evidence/2026-10-16-slider-controls-inertia/final-sdk-export-parity.json).
The complete release ID appears below. A pack or inventory check alone does not
prove rendering.

## Actual official-player browser acceptance

Independent browser QA passed **118/118 assertions** against the actual local
URL `http://127.0.0.1:8344/?sdk=fresh-ui-verified`, using Playwright's Microsoft
Edge channel and isolated production-page contexts. The exported page loaded
the official release
`c303df1081b7346b1bd41e00d7fe2d53bbac85a3c4672176d40768b41822f6d1`
and `@unone/ui` 0.3.0 at 1440x900, 1020x884 and 390x844.

Physical mouse input exercised visible-track capture, range clamping, release
outside, a new gesture after release, row pan versus tap, combobox/apply and
shared press/release readers. Natural coast continued after release, slowed and
settled away from content bounds; new presses and wheel input stopped it.
Platform pause/resume checks used explicitly labelled synthetic lifecycle
events, with physical pointer gestures. QA inspected all three screenshots and
reported readable authored layouts, expected clipped partial virtual rows and
no error overlay. No console, page, request or HTTP errors were reported.

All 107 exported files, including retained prior-release files, stayed unchanged
before and after QA. This is one actual Web export's acceptance, not native
scroll, physical mobile, accessibility, every widget composition or a fitted
measurement of the decay coefficient. The test verifies the configured rate
from the public descriptor and relative timed coast behavior. See the
[raw browser summary](../evidence/2026-10-16-slider-controls-inertia/browser-summary.json),
[full observations](../evidence/2026-10-16-slider-controls-inertia/browser-after.json),
and [screenshot/artifact hashes](../evidence/2026-10-16-slider-controls-inertia/browser-artifacts.json).
PNG files remain in ignored artifacts.

## Prescribed Claude attempt

Claude Code `2.1.280` was invoked read-only with tools disabled, an empty MCP
configuration, plan permission mode, no session persistence and a two-turn
bound. It timed out at 55 seconds (55.2 seconds measured), exit 124, with zero
stdout/stderr bytes. **This was not a completed Claude review and supplies no
approval.** The exact argv, baseline, timeout and output sizes are in
[attempt metadata](../evidence/2026-10-16-slider-controls-inertia/claude-attempt.json).

The supplied 86,542-byte fixed diff has SHA-256
`8c5df2ac43d05d867fc7adfc435f4e97c8ff8430cf0b89eecb4b357f9444c3a3`.
Its exact bytes are preserved as
[base64 JSON](../evidence/2026-10-16-slider-controls-inertia/claude-fixed-diff.json),
with the empty raw stdout/stderr retained separately. That snapshot preceded
the numerical correction and subsequent final validation/discovery cleanup.
Independent source review, executable regressions and actual browser QA are
separate evidence; none is presented as a Claude conclusion.
