# ADR 0002: Seven Game Categories Are the Engine's Formal Acceptance Gate

Date: 2026-09-05  
Status: accepted

## Decision

Unone's long-term goal is complete only after all seven game categories below have playable validation versions and each has passed the functional, deterministic-test, AI development-loop, platform-smoke-test, and development-record requirements:

1. 3D racing
2. Red Alert-style RTS
3. Dota Legends-style idle combat
4. AVG dating game
5. Auto battler
6. Slot machine
7. Fish arcade game

Angry Birds 2D is the first mid-term validation game, not a final acceptance condition.

## Passing Evidence

Each game must have a rebuildable project, its core gameplay, at least one headless regression test, an AI-operable inspect/edit/reload/run/observe/diagnose loop, a smoke test on the corresponding platform, and devlog/issue records with screenshots.

## Rationale

The seven categories cover 2D physics, data-driven flow, numerical simulation, RNG, board rules, large numbers of Entities, RTS/networking, and 3D/vehicle physics. Passing them individually is what proves this is a game engine rather than a scripting framework suited only to one demo.

## Reconsideration Conditions

If the scope of a game category must be substantially reduced, record the acceptable definition of its “validation version” and the capabilities that remain unvalidated; do not label unfinished work as passed.
