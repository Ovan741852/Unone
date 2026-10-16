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
in `project.unone.json` (`"runtime_packages":{"@unone/ui":"0.1.0"}`). The returned
kit has typed text/button/panel/image/component constructors; it is not an npm
module or a new renderer. Keep themes, content, state, action meanings and
geometry in project Luau. Custom factories remain valid.

For font/style changes search `game api search "font size"` / `"text alignment"`
/ `"border padding"` and read [the shared style contract](docs/ui-styling.md).
Use existing typed leaves, licensed faces in `presentation.ui.fonts`, and
`api.ui.getViewport()` for project-authored responsive choices. Refresh
`game api typings` and the SDK when upgrading. A font/style request does not
authorize replacing the official player.

Use `kit.component({...surface={kind="panel"}})` or an image surface for ordinary
card backgrounds. The package prepends `id.."/surface"` with explicit
`background_for={component=id}` and the component's unchanged authored placement.
Children retain their coordinates and order. Custom factories may carry the same
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
leaves. Do not add AABB metadata or a runtime layout engine from this model. AABB
can describe a proposed bound or validation question; it does not decide responsive
placement by itself.

Mechanical layout is opt-in. Only propose or add it when the user explicitly uses
keywords such as `機械式`, `固定規則`, `座標規則`, `自動檢查`, `規則化`,
`deterministic`, `constraint solver`, or equivalent wording. A recommendation is
not authorization. Before adding it, explain the semantic problem, mechanical
scope, decision flow, fallback behavior and trade-offs. Apply it only after the
user explicitly agrees.

The decision flow is: understand intent → propose semantic grouping → check
whether a mechanical guarantee is actually needed → if yes, show the opt-in
keywords and concrete rule → wait for explicit agreement → implement and verify
the rule. Runtime validators may report containment, overlap, overflow and hitbox
failures, but must not silently choose or rewrite the layout for the AI.
