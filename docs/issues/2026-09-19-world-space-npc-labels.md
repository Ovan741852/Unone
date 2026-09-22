# Wuxia sandbox: world-space NPC labels

## Status

Game-side data is ready; Unone host renderer support is still required for
true labels above moving 3D characters.

## Reproduction / evidence

Project: `_Games/wuxia-sandbox`

The Luau runtime now publishes `observations.world_labels` and includes
`head_label` plus `world_position` in every NPC snapshot. Each label contains
the resident name and current intent, for example `沈長安 · 🌿 採集`, with a
world position above the NPC. The world was expanded to a 21 × 19 grid and the
camera/floor were widened for 40 residents.

## Current renderer gap

`api.ui.setRoot` only accepts normalized screen-space rectangles. It cannot
anchor text to a 3D entity or project a world position through the active
Camera3D. Adding 40 ordinary text nodes would overlap the roster/details UI and
fail the UI layout gate; it also would not follow moving NPCs.

## Requested Unone capability

Please confirm and implement one of these reusable presentation paths:

1. a world-space label primitive with `{entity_id, text, offset, visible}`;
2. a camera projection API plus a host-owned world-label layer; or
3. an equivalent renderer contract that consumes `observations.world_labels`.

Acceptance:

- names and current action remain above the correct NPC while it moves;
- dead residents hide the label or show a grave label according to the game
  payload;
- labels are depth-aware and do not render through buildings;
- native and Web/player hosts produce the same label placement;
- no screen-space UI layout overlap is introduced.
