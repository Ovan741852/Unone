# Explicit responsive UI layout in the official package

Status: accepted, 2026-10-16. Package: `@unone/ui` 0.4.0.

## Problem and ownership

Projects repeated viewport threshold selection, row and column allocation and
top-left to stage rectangle conversion. Copying that machinery also encouraged
inconsistent breakpoint boundaries and mixing stage, scroll and anchor units.
The user explicitly requested reusable responsive layout in the official UI
package. This is an explicit opt-in to shared layout calculation.

These calculations are reusable UI mechanics. They belong in the pure Luau
package. Content order, meaningful groups, authored thresholds, visual tokens
and application state remain project decisions. No game identity, settings
screen geometry, theme or device name belongs in the implementation.

## Decision

Both the direct package and themed kit expose `createResponsiveLayout(options)`.
It snapshots authored variants containing a name, inclusive `minAspect`, layout
tree and typed values. Variants are strictly ascending, starting at zero. The
model's pure `resolve(api.ui.getViewport(), bounds?)` selects the largest matching
threshold, allocates named row/column/grid regions, and returns canonical
rectangles and viewport bounds alongside the selected name and values.

Rows and columns subtract declared padding, gaps and fixed item sizes, then
share remaining space by positive grow weights. Grids reserve the declared
column count and equal cells. All layout lengths use existing normalized stage
units per axis. Font and anchor vertical units keep their separate contract.

The model explicitly selects stage or scroll space. `rect(id)` produces stage
y-up rectangles or scroll-local y-down rectangles; `viewport(id)` uses top-left
y-down in either space. It does not move existing nodes or establish a new
component origin. Projects use these returned bounds when constructing ordinary
nodes, slider views and scroll helpers. Registered virtual nodes keep their
identity and lifecycle.

Invalid thresholds, duplicate IDs, non-finite numbers, impossible allocations,
unknown props and bounded-work violations are diagnosed. The zero threshold is
the fallback for small valid aspects; invalid declarations never select a
hidden alternative. The helper does not measure text, shrink fonts, infer
semantic order, introduce callbacks or publish UI. Resolving a view advances no
simulation tick, input or random state.

## Alternatives and consequences

A breakpoint table alone still leaves every project implementing allocation and
coordinate conversion. An implicit transform on `component` would change an
established origin contract and complicate virtual-node and slider projection.
A renderer-specific layout implementation would duplicate policy across hosts.
The chosen pure geometry model uses the existing transport on all hosts and
keeps each renderer unchanged.

This is a bounded explicit layout API, not intrinsic HTML/CSS layout. Authors
declare variants and sizes; normal UI validation and actual player checks still
establish whether text and artwork fit. Fixed-aspect game-world composition is
separate from UI layout. The UI package, types, CLI and executable runtime must
be upgraded together because package source is embedded in Core.

See [the public API and examples](../ui-responsive.md).
