# Agent instructions

## Branching policy

This project does not use feature branches. Develop directly on the
default branch (`main`). Do not create, switch to, or push new
branches unless the user explicitly asks for one.

This applies to all coding agents working in this repo, including
Claude Code and Codex.

## Default game presentation

Use the official Unone player for game presentation. Start with
`game platform snapshot`, inspect the project's presentation settings, and
follow [the AI workflow](docs/ai-workflow.md) and [player export](docs/player-export.md).
A passing headless replay does not prove that a player rendered the game.
Validate the exported official player on the requested target before reporting
visual completion.

For exhaust, sparks, explosions, trails, smoke and auras, first search
`game api search "explosion"` / `game api search "particle"`, describe the matching
APIs, and use scene `particle_effects` with `api.particle.*`. Inspect
[Particle Lab and the declarative format](docs/native-particles.md) before
implementing an effect from scratch. Keep the particle system enabled when the
game uses it. Effekseer is an optional external-asset path with host-specific
requirements, not the default answer to every effect request.

Game code declares presentation and uses engine APIs. GPU contexts, draw calls,
shader compilation, material resources and renderer lifetime belong to the
engine's presentation layer. Custom shaders must use the engine's supported
shader interface; a shader request does not authorize writing a replacement
renderer. If a required shader feature is unsupported, report the specific gap
and extend the reusable engine interface rather than silently adding game-owned
WebGL/OpenGL/WebGPU plumbing.

Replace the official renderer only as an explicitly selected extension mode for
a stated project requirement. Declare `renderer_mode: "custom"`, `renderer_module` and the complete
`renderer_files` inventory in `player.presentation.json`; see the
[selection contract](docs/ai-workflow.md#renderer-selection-and-replacement).
Do not infer renderer replacement from "make it look better", "use shaders", a browser
target, or an example of a low-level graphics API. Preserve and report the
chosen renderer and its visual verification scope in the handoff.

## Engine versus gameplay ownership

Before adding any engine capability, first classify it as gameplay/business
logic or a reusable engine primitive, and explain that classification. Do not
move a single game's behavior into Rust merely because it is convenient.

Gameplay rules belong in Luau: projectile speed, acceleration/gravity choices,
integration policy, firing, lifetime, damage, hit responses, effect selection,
cooldowns and scoring. Rust may provide reusable geometry/collision queries;
the presentation layer may provide reusable rendering such as Bloom and asset
decoders. Neither should encode this game's rules or resource choices.

When ownership is unclear, keep the behavior in Luau until a concrete reusable
requirement justifies an engine primitive. This is a design check, not a request
to ask the user for permission before every routine change.

## AI-first layout decisions

Start shared controls with the official `@unone/ui` pure Luau package, bundled
with Core and the SDK. Search `game api search "UI package"` / `"shared components"`
/ `"button component"` / `"card component"` / `"官方UI套件"` / `"共用元件"` /
`"主題樣式"`, describe `ui.components.info` and `ui.components.create`, and read
[the package contract](docs/ui-components.md). Declare the exact package version
in `project.unone.json` (`"runtime_packages":{"@unone/ui":"0.4.0"}`). Both
`api.ui.components` and the themed kit returned by `create` expose typed
text/button/slider/combobox/panel/image/component/screen constructors, the
`createSlider` numeric control, `createResponsiveLayout` model, plus
scrollView/virtualList/virtualGrid wrappers. Search `"create button"` /
`"slider drag"` / `"slider value"` / `"滑桿拖曳"` / `"下拉選單"` /
`"virtual list"` for the actual methods.
This is not an npm
module or a new renderer. Keep themes, content, application state, action meanings and
authored semantic grouping in project Luau. Custom factories remain valid.

For responsive composition search `"responsive layout"` / `"breakpoints"` /
`"row column grid layout"` / `"自適應排版"`, describe
`ui.components.createResponsiveLayout`, and read
[the shared responsive contract](docs/ui-responsive.md). Create one
`UiResponsiveLayout<T>` from typed authored variants and retain it; call
`resolve(api.ui.getViewport(),bounds?)` in the pure View. Pass `result.rect(id)`
to leaves and `result.viewport(id)` to scroll helpers. The package owns aspect
selection and explicit row/column/grid arithmetic; do not copy breakpoint tests,
coordinate conversion or region sizing into every project. Projects own semantic
groups, thresholds and complete typed `values` records, including typography
choices. A component never lays out its children implicitly. Use explicit
`space="scroll"` for local content; layout lengths are per-axis rectangle units,
not `UiStyle` vertical units. No intrinsic text measurement or automatic wrapping
is provided. Strictly increasing thresholds start at `minAspect=0`; an exact
boundary selects the new variant. Unknown fields and overflow fail explicitly.

For button activation search `"button click"` / `"button pressed"` / `"按鈕點擊"`
/ `"按下瞬間"` and use `api.input.wasPressed(action)` in `Game.update`.
`wasReleased(action)` reads release edges and `isDown(action)` reads held state.
These are non-consuming current-versus-previous-successful-tick snapshots,
not callback properties or queued platform events. Do not invent `onClick`,
`input.isActionJustPressed`, low-level `slider(props).value` or automatic combobox options.
Use canonical `EngineApi`, `UiApi`, `UiComponentKit`, `UiSliderControl` and node/style types from
`game api typings`; do not use handwritten `ui:any` stubs. New entry scripts
mark the canonical block; refresh it with
`game --project <game-root> api typings --update-script gameplay.luau`, which
preserves surrounding game code and rejects missing/duplicate/malformed markers.
Never point `api typings --output` at an existing game entry script.

Use `kit.createSlider({id=...,value=...,min=...,max=...,step=...})` for numeric
sliders. Create and retain each control once in `Game.start`; publish
`control.view({rect=...,trackRect=...})`, and call `control.update(api.input)`
once per `Game.update` to read the value and interaction edges. The official host
owns projected/clipped hit testing and pointer capture, including scroll-local
controls; do not duplicate screen-pointer drag mapping in projects. `view` is
UI-pure and supplies no layout or artwork. Virtual `renderItem` callbacks may
call only `view`, with persistent controls keyed by item identity. Use
`setValue` for explicit external changes or resets, and `cancel` to abandon a
drag; both ignore the old held gesture until a new start. The low-level
`slider(props)` remains compatible but does not accept value/range props or
create a numeric controller. See [the complete slider lifecycle](docs/ui-components.md#interactive-sliders).

For optional scroll drag inertia, search `"scroll inertia"` /
`"捲動慣性"` and use `scrollView`/`virtualList`/`virtualGrid` options
`inertia=true,deceleration=8`. Defaults are no inertia and exponential decay
8 inverse seconds; deceleration must be finite and in `(0,100]`. Offsets stay
clamped without elastic overscroll. Follow [the shared scroll contract](docs/ui-scroll.md)
and its target-host limits.

For font/style changes search `game api search "font size"` / `"text alignment"`
/ `"border padding"` and read [the shared style contract](docs/ui-styling.md).
Use existing typed leaves, licensed faces in `presentation.ui.fonts`, and the
official responsive model with `api.ui.getViewport()` for authored choices. Refresh
`game api typings` and the SDK when upgrading. A font/style request does not
authorize replacing the official player.

Use `kit.component({...surface={kind="panel"}})` or an image surface for ordinary
card backgrounds. The package prepends `id.."/surface"` with explicit
`background_for={component=id}` and the component's unchanged authored placement.
Children retain their coordinates and order. A component does not establish a
local origin: stage children remain 0..100/y-up; scroll content remains local
top-left/y-down. Package wrappers preserve existing scroll lifecycle/host limits.
Custom factories may carry the same
metadata on their own image/panel leaf. Search `"card background"` /
`"component overlap"` for canonical ancestor/bounds checks. Retain strict
foreground/partial overlap checks; use exact-pair policies only for deliberate
art/skin layers that do not meet containing-background semantics.

For UI layout, responsive grouping, hierarchy and visual composition, default to
semantic AI reasoning rather than mechanical coordinate rules. Infer groups from
task, role, reading order, interaction focus, lifecycle and safe-area constraints;
do not turn one screen's pixel arrangement into a runtime rule automatically.
Use relative spaces and AABB containment as an AI reasoning vocabulary: distinguish
Viewport, fixed-aspect Stage, Background layer and layout Regions before placing
leaves. Do not infer new AABB metadata or a hidden runtime layout policy from this model. AABB
can describe a proposed bound or validation question; it does not decide responsive
placement by itself.

Mechanical layout is opt-in through `createResponsiveLayout`. The user-requested
shared responsive helper is an authorized reusable package capability; using its
authored definitions requires no extra permission flow. Understand intent,
choose semantic groups and reading order, declare explicit variants/regions,
resolve them, then verify geometry and the official player. This helper does not
authorize inferring hidden rules or adding a constraint solver. Runtime validators
may report containment, overlap, overflow and hitbox failures, but must not
silently choose or rewrite the layout for the AI.
