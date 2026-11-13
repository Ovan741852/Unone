# Shared gesture acceptance

The official production Web player exported `tests/gestures-project` using
`@unone/gestures` 0.1.0 and `@unone/ui` 0.6.0. Rendering used the official host;
the recognizer source was embedded by Core, with no game-owned pointer tracker
or custom browser host. The installed canonical type contract passed strict
analysis and all four fixture replays passed native/exported-WASM comparison.

Chrome DevTools dispatched real multi-point touch input to the exported
canvas. Computed canvas `touch-action` was `none`, supplied by the ordered
router rather than project CSS. These native composited JPEG captures show:

- `before.jpg`: zoom 1.00, rotation 0, no contacts.
- `pinch.jpg`: zoom 2.00, no contacts; moving the remaining finger after the
  other finger released did not move the tile.
- `rotation-pan.jpg`: zoom 2.00, rotation 90 degrees, no contacts; a fresh
  single-finger drag after rotation moved the tile normally.

The browser error log was empty. This is a local official Web export with
browser-emulated touch, not a physical iOS/Android device certification.
Machine-readable source hashes, runtime metadata and final test scope are in
`report.json`.
