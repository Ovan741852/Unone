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
