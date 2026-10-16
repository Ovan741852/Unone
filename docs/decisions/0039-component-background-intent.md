# ADR 0039: background ownership travels with reusable UI components

Status: accepted, 2026-10-16.

## Context

The official UI already supports reusable Luau factories over typed component
trees. A settings example still needed 68 external overlap pairs: 62 described
five ordinary backgrounds, and six described intentionally layered slider skins.
The external file exposed each factory's private leaf IDs and had to change
whenever a component gained a label. Adding another widget factory would not
remove this validation burden.

## Decision

Add optional `background_for` metadata to existing `panel` and `image` leaves.
Its scope is explicitly either `{screen=true}` or `{component="ancestor_id"}`.
A component factory declares the relationship alongside its surface once;
every instance carries the same reusable intent without listing its descendants.
The scope discriminator distinguishes a screen from a component even if their
IDs coincide in a legacy tree.

Core checks the declaration before publishing the tree. A component target must
be an actual ancestor in the same coordinate space; the background must fit its
declared scope. Screen scope applies only to stage coordinates. Scroll content
starts a separate coordinate space and cannot reference an outer scope.

The layout inspector records an intentional overlap only for a later leaf that
belongs to the declared scope and is fully contained by the background rectangle.
It still reports content/content collisions, partial intersections, outside-scope
siblings and a later panel covering earlier content. Existing comparison and
diagnostic limits remain authoritative. Scroll content remains outside the
headless stage preview's projection.

This is shared validation data, not game behavior or a renderer feature. It does
not move, resize, clip, reorder, style, inherit, bind or capture input. Components,
themes, screen choices and responsive composition remain authored in Luau. Hosts
continue to paint the same leaves in the same order. Existing version-1 exact
pair policies retain their contract for deliberate art/skin layering that is not
a containing background.

## Alternatives and consequences

Scoped external policies would reduce entries but still separate component intent
from its factory and require instance-specific IDs. Guessing backgrounds from
size, color, name or paint order could hide mistakes. A generic card/button API
would encode a theme without addressing the validation issue. These alternatives
are unnecessary for the demonstrated problem.

The transport, strict Luau types, generated schema and API guidance evolve
together. Projects using the field need a matching CLI and player runtime; an
older runtime rejects it as an unsupported field. Background metadata is not a
claim about opacity, rounded corner coverage or final glyph readability. Actual
official-player visual/input acceptance remains necessary.
