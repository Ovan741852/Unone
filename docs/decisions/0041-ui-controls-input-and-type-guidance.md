# ADR 0041: consistent UI construction, tick edges and safe type refresh

Status: accepted, 2026-10-16.

## Context

The first official UI package covered only some existing node kinds. Authors
mixed typed constructors with raw slider/combobox nodes and separately named
scroll helpers. Methods on a returned kit were difficult to discover as callable
APIs. Natural requests such as "button click" found no operation, encouraging
invented callbacks or input methods. Handwritten `ui:any` contracts also hid
errors even when the canonical engine contract was available.

## Decision

`@unone/ui` 0.2.0 supplies one constructor vocabulary for the existing text,
button, slider, combobox, panel, image, component, screen and scroll nodes.
`api.ui.components` is a default kit with real callable/indexed constructors;
`create(theme)` returns the same methods with explicit per-kind style defaults.
Both paths share the implementation. Legacy raw nodes and the original engine
scroll methods remain valid. Exact package requirements still select a matching
SDK/player; maintained projects explicitly upgrade their declarations.

Scroll and virtual constructors forward to the existing engine helpers. They
retain callback contracts and registered live-node ownership. No second scroll
registry, control transport, layout system, value binding or application state
manager is introduced. Components retain the current coordinate space; they do
not make children relative, inherit style or choose geometry. Search, types,
examples and misuse diagnostics state these rules at the construction boundary.

`input.wasPressed` and `input.wasReleased` are shared simulation input queries.
They compare the final host held-state map with the last successful tick's held
state. Queries are non-consuming and stable for a tick; several readers can
observe the same edge. A failed tick does not advance this input baseline or
replace the prior published edge snapshot. This is an input-state guarantee,
not a new transaction over arbitrary Luau/world mutations. Startup reports no
edges; outside update, reads retain the most recent successful tick snapshot.
Existing `isDown` remains the held-state query. Game actions and reactions stay
in project Luau rather than UI callbacks.

The official type contract is explicitly marked in new project scripts.
`api typings --update-script <project-relative-script>` refreshes one complete
marked block and preserves every byte outside it. Missing, duplicate, reversed
or embedded markers fail without guessing code boundaries. Path confinement,
staged writes and atomic replacement protect existing source; an unchanged block
does not write. `--output` remains an independent contract-file export and cannot
be combined with script refresh. Existing unmarked projects require deliberate
initial integration of the canonical types.

Source web export checks required package versions against the selected runtime
before reading content or producing an output, and checks the content's actual
configuration again before serialization. SDK selection uses the same version-gap
logic. The public project starter declares every optional system explicitly and
enables only the 2D/UI/particle systems it demonstrates; existing projects retain
their system defaults. Virtual row option types are generic, allowing each game
to retain its model type through key/render callbacks without engine-specific rows.

## Consequences and alternatives

An additional game-owned click detector would repeat lifecycle state and keep
the discovery gap. A UI-specific `onClick` dispatcher would mix presentation
construction with application execution. Consuming input events would make
behavior depend on reader order. Generic tick-edge snapshots avoid those costs.

Synthetic search entries for unavailable methods would mislead callers. Real
default-kit constructors make the same names callable, typed and searchable.
Automatic coordinate transforms, inferred type boundaries and analyzer injection
would hide decisions or rewrite authors' code. Explicit construction and marked
refresh keep ownership reviewable. Existing font catalogs, explicit fallback
stacks and actual player/font acceptance remain the typography workflow.
