# Responsive Layout Lab

A fresh-author example built only from the portable Unone SDK, its official
documentation and API discovery. Uses `@unone/ui` 0.4.0 and the official player;
no project-owned DOM, CSS layout or renderer.

`createResponsiveLayout` selects authored narrow/medium/wide variants with
1/2/4 equal grid columns. The toolbar combines one fixed-width action with a
grow region. A reusable card factory resolves a second shared layout model into
each cell's bounds. Typography and reading order remain authored project choices.
The refresh count is independent of layout and survives window resizing.

Use a matching SDK and the normal author workflow:

```powershell
game --project . verify
game --project . project prepare --target web --output dist/player
```

Serve the returned directory with the SDK's `scripts/serve-player.py`. Use a
fresh output directory for another prepare, or archive the prior local output.
The default gates cover strict types, assets, layout and two deterministic
state/input cases. Actual Web acceptance is recorded separately in the engine's
responsive UI review; it includes desktop, square and portrait window sizes.
