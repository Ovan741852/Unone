# Agent instructions

## Branching policy

This project does not use feature branches. Develop directly on the
default branch (`master`). Do not create, switch to, or push new
branches unless the user explicitly asks for one.

This applies to all coding agents working in this repo, including
Claude Code and Codex.

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
