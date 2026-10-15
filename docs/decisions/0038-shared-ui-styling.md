# ADR 0038: shared typography and box styles on existing UI leaves

Status: accepted, 2026-10-15.

## Context

The official player already transports text, buttons, image skins, semantic
controls, reusable component trees and scroll helpers. Its old text fitting had
no portable author control for font size, hierarchy, alignment, spacing or box
styles. Moving a polished UI into the official host therefore lost typography,
and encouraged game-owned HTML/GPU presentation. Existing UI transport and
component composition should remain the common path.

## Decision

Add an optional typed `style` to the existing UI leaves and a decorative `panel`
leaf. Core validates and serializes bounded style data; official Web/native
hosts own font resources, text measurement and painting. Typography and box
lengths share vertical design units. Explicit styles use fixed size defaults;
unstyled leaves retain the prior fitting behavior. Styles are local and never
inherit through component containers.

Package multiple named font faces through `presentation.ui.fonts` with family
aliases and weights. TTF/OTF form the shared target catalog. Keep the old
single-font declaration compatible and diagnose unsupported native formats.
Expose `ui.getViewport` as a read-only aspect observation for authored responsive
decisions; do not choose placement or implement a constraint/layout solver.

The existing `component` tree remains the reusable composition boundary. Game
and SDK functions may create themed buttons, cards, dialogs and status bars from
these shared leaves. Core receives no game-specific theme, component catalog,
business commands, screen transitions, ViewModel or reactive subscriptions.
Decorative leaves do not capture input over semantic controls; action routing
continues to use the established host input boundary.

## Alternatives and consequences

Game-owned HTML/CSS or renderer replacement would bypass the official player's
ownership and duplicate input/asset behavior. A separate UI widget transport
would duplicate the existing component system. Automatic layout or MVVM in Core
would move game policy and lifecycle into the wrong layer. None is required for
portable typography and box primitives.

Core's older "no new UI primitive" proposal wording is narrowed by this accepted
decision: reusable presentation data can evolve with an explicit shared contract.
The MVVM and manager responsibility boundary is unchanged.

Rasterizers and installed glyph fallback still differ. Exact text pixels require
target visual acceptance; deterministic Core replay is not font-rendering proof.
Native UI still rasterizes/uploads a changed surface and does not gain scroll
support or a new performance guarantee. Limits, defaults and examples live in
[the current style contract](../ui-styling.md).
