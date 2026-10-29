# Native normalized input replay

`--input-sequence <file.json>` feeds an explicit JSON array of
`unone_engine::InputFrame` to the official native player. This is a reusable host
test facility: action names, pointer coordinates and expected gameplay results
belong to the project. It uses the same `EngineRuntime::tick_with_input` entry
point as other hosts. It neither controls the desktop nor synthesizes OS input.
`game schema input` supplies the structural schema for each array entry.

```json
[
  {"actions":{"Move":true}},
  {"actions":{"Move":true}},
  {},
  {"pointer":{"position":{"x":3,"y":4},"down":true}},
  {"pointer":{"position":{"x":3,"y":4},"down":false}}
]
```

Use an existing verified native export and a frame limit:

```powershell
unone-native-player.exe --root <export-directory> --input-sequence inputs.json `
  --fixed-tick --warmup 0 --prewarm-ticks 0 --frames 120 --report result.json
```

Add `--headless` for simulation-only testing, or `--capture-dir <new-directory>`
to capture the actual native renderer. Existing capture sampling is at most ten
images per wall-clock second; it does not capture every simulation tick.

Replay requires `--fixed-tick`, `--warmup 0`, `--prewarm-ticks 0`, and a positive
`--frames` limit. `--freeze-simulation` and nonzero `--seconds` are rejected.
The normal desktop default of 60 warmup presentations must be explicitly changed
to zero. These restrictions apply equally to GUI and headless runs.

`Game.start` executes normally with empty input at simulation frame 0. Array
index 0 supplies the first update, simulation frame 1. Each successful tick
consumes one array entry. Held actions must be repeated in every frame where
they remain held; a missing action is released. After exhaustion, each tick gets
an empty input frame, releasing held actions and pointers. An empty array is a
valid all-empty replay. Failed ticks do not consume an entry.

GUI replay advances once per successful presentation. If a surface timeout or
loss requires retrying the render, it retries the same snapshot before advancing
the next input. Headless replay advances once per loop iteration. Captures,
window resizing and machine performance can change wall-clock timing; they do
not select a different input index. Window size may still affect game-authored
viewport-dependent behavior, so compare runs at the same dimensions/aspect.

During replay all live keyboard, mouse and touch gameplay input is ignored,
including semantic UI routing. Sequence actions and `ui_sliders` are already
normalized semantic input; pointer coordinates are supplied directly to the
kernel rather than projected through native UI hit testing. Window close,
resize, focus and suspend/resume remain host lifecycle events. To test the
native UI hit tester or physical key mapping, run a separate live-input test.
On Windows a replay window is created with initial activation disabled, so it
does not request keyboard focus from the application the user is working in.
Normal live-input windows keep their existing activation behavior.

Files must contain exactly one JSON array, at most 8 MiB and 60000 frames.
Unknown fields, invalid types, trailing content and invalid normalized input
fail explicitly. The parser bounds the frame count during decoding. Each frame
also permits at most 256 actions and 1024 UTF-8 bytes per action name; the
kernel's pointer, nonblank action and slider validators remain authoritative.
Errors use `NATIVE_INPUT_SEQUENCE_*` codes and are never treated as empty input.

The final `input_replay` report includes the SHA-256 of the exact file bytes,
`frame_count`, `applied_frames` (actual sequence entries consumed),
`simulation_ticks`, `empty_frames_after_sequence`, `exhausted`, and successful
presentation/readiness counts. `--describe` advertises the format and limits.
The file hash identifies external test input separately from the verified game
package hash; the sequence is not added to or written into the export inventory.

A passing replay proves simulation state under normalized input. Visual
acceptance also requires successful GPU rendering and inspection of captures.
Headless runs report zero successful presentations, never emit
`UNONE_NATIVE_READY`, and provide no GPU visual evidence.
