# Official gesture lab

This minimal official-player fixture exercises `@unone/gestures` 0.1.0 through
the real input API. It uses shared UI constructors, no custom renderer/assets
or game-specific camera logic.

- One finger moves the blue tile after the pan threshold.
- Two fingers translate/scale the tile and rotate its yellow direction marker.
- Lifting one finger suppresses the remaining finger until all lift.
- Reset/Pause/Resume demonstrate authored state and recognizer lifecycle.

With a current CLI and Luau analyzer:

```text
game --project tests/gestures-project verify --json
game api describe input.gestures.create
```

Build a matching official Web runtime with this fixture's systems using
`scripts/build-web-live.ps1 -Player -Project tests/gestures-project ...` (or
the documented POSIX runtime builder), then `game export web --runtime ...`.
The runtime must advertise both declared exact package versions. The Web
builder executes native/exported-WASM parity for all four deterministic cases.
Serve the export with `scripts/serve-export.py` and test actual touch input.

Canonical types in `types.luau` are an explicit marked copy; refresh with
`game --project tests/gestures-project api typings --update-script types.luau`.
The four replays cover pan, pinch plus remaining-finger suppression, rotation
and UI-owned touch rejection. Broader lifecycle and ownership cases live in
`crates/unone-engine/tests/gestures.rs`.
