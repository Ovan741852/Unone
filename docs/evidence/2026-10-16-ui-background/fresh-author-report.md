# Fresh-author UI audit

## Result

Project: `D:/TSProject/UnoneUiBackground-20261016/project`

Official production Web export: `project/dist/web/index.html`.
`project prepare --target web` returned `status: ready`, selected
`web-production-0`, synchronized and activated bundle generation 1, and exported
`renderer_mode: official`. The launch root is `project/dist/web`.

Normal `verify` passed all four gates: strict types, assets, layout (zero
findings), and tests (3/3). The prepare operation independently reported the
same passing gates. Tests cover zero initial counts, two ambience actions and
one motion action producing independent counts, and a held action counting once.

## Public discovery route

Only the supplied portable SDK, official documentation, generated public
contracts, and the authorized analyzer executable were used as inputs. No
engine source, Git history, game examples, earlier author output, or web material
was read. The font directory was available but unused.

1. Read official README and AGENTS, then their linked portable SDK, typography,
   AI workflow, and player export guides. Reading all four guides in one command
   produced too much output for the tool response; raw output remains in 004.
2. `game --help`, `sdk inspect`, and `project init` exposed the portable workflow.
   Every game invocation used an explicit `--sdk`. Verification used the specified
   official analyzer through `UNONE_LUAU_ANALYZER`.
3. API searches `card background`, `component overlap`, and `font size` all found
   `ui.setRoot` and `ui.inspect`. `api describe ui.setRoot` confirmed the scoped
   background semantics. `api describe input.isDown` confirmed semantic actions.
4. `schema ui` exposed `UiBackgroundScope` as exactly `{screen: true}` or
   `{component: string}`; the starter's canonical strict Luau types include the
   same union and `background_for` on image/panel leaves. `schema test` and the
   workflow guide supplied the observation equality and input sequence contracts.

## Authored composition

One typed `settingsCard` Luau function produces two component instances:
`ambience` and `motion`. Each owns a rounded decorative panel, heading,
description, counter label, and rounded semantic button. The panel carries
`background_for = {component = id}` inside the reusable function. Its ID refers
to its actual ancestor component instance. There is no external overlap policy
or per-leaf pair list. A screen panel separately declares `{screen = true}`.

The authored desktop composition uses two side-by-side cards, explicit type
sizes/weights/alignment, wrapped descriptions, deliberate color hierarchy, and
the official sans-serif fallback. Styles remain local to leaves. It uses the
documented stage coordinates (0..100, y upward) and vertical typography units.

Stable buttons: `ambience_button` / `IncreaseAmbience` and `motion_button` /
`IncreaseMotion`. Counters: `ambience_count`, `motion_count`.
Observation `settings` contains `ambience`, `motion`, and `last_action`.
Two ambience clicks followed by one motion click should produce
`{ambience: 2, motion: 1, last_action: "IncreaseMotion"}`.

## First failures and corrections

The first actual CLI failure was scaffold Web preflight (022, exit 1):
`SDK_RUNTIME_UNAVAILABLE`, with concrete missing systems `camera3d`, `physics2d`,
and `save`. The SDK inspection and systems report made this actionable. This UI
uses none of those systems, so the project explicitly disables them. Unused
starter particles and the starter scene behavior were also removed. Corrected
preflight (028) returned compatible; prepare (029) returned ready. The generic
starter/runtime mismatch was the main SDK friction.

Two author tooling errors occurred before verification: an apply-patch request
tried deleting and adding the same scene path in one patch, and a nested
PowerShell JSON quote was malformed (025, exit 1). Both were corrected locally;
026 wrote the scene successfully. Exact errors and the correction are retained
in `tooling-errors.txt`. Neither required an engine or SDK change. The authored
Luau and UI passed their first verification run (027).

## Time, evidence, and limits

First recorded discovery: 10:09:55 +08:00; ready export: 10:14:19 +08:00,
approximately 4 minutes 24 seconds. Report preparation followed. Numbered
001–030 text files retain actual commands, exit codes, and raw outputs; the
Audit.ps1 helper captures later commands consistently. Tool response truncation
did not truncate the saved CLI output.

This author performed deterministic and packaging validation. Real browser
visual/input acceptance belongs to the independent root acceptance record.
No custom font metrics or other platform parity is claimed. No SDK blocker
remained at handoff; a reusable helper still authors global stage rectangles,
as documented, rather than inheriting coordinates or styles from its component.
