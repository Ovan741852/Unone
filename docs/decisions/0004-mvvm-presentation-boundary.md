# ADR 0004: Use MVVM for UI/Presentation, Not for the Entire Engine

Date: 2026-09-05  
Status: accepted

## Decision

Unone uses a hybrid architecture: ECS + systems handle high-frequency game simulation; Luau MVVM handles UI, screen flow, dialogue, shops, quest panels, and other presentation. The engine provides only minimal UI-node, binding, observable, and command primitives; the game business side defines the ViewModel.

## Rationale

MVVM's explicit state → projection → view boundary suits AI inspection, typed context, command generation, and testing. However, wrapping physics, transforms, and Entity simulation in ViewModels would add synchronization, allocation, and lifecycle complexity, moving away from the responsibilities a game engine actually needs.

## Boundary Rules

- A View does not directly modify ECS or execute game rules.
- A ViewModel is a typed, serializable Luau presentation projection.
- Commands must have a name, inputs, prerequisites, results, and diagnostics.
- Bindings must be explicitly declared and removable; do not build global magic two-way binding.
- The engine does not own the game's ViewModels, screen flow, or domain-state schema.

## Reconsideration Conditions

Expand the engine UI primitives only if three or more validation games demonstrate the same recurring UI binding/command problem; if it is only a single shop, dialogue, or dating flow, keep it on the game side.
