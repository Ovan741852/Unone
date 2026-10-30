# Native renderer readiness

The native player exposes a small stdout handshake for a host that manages its
process. It is a presentation/host signal, not an engine or gameplay signal.

## Contract

`--describe` declares the contract under `readiness`, and
`scripts/build-native-player.ps1` copies that object into the generated
`runtime.json`. The current declaration is:

```json
{
  "contract": "unone.native-ready.v1",
  "stdout_prefix": "UNONE_NATIVE_READY ",
  "emission": "once_after_first_render_ok_true",
  "requires_surface": true,
  "headless": "never_emits",
  "fields": [
    "contract",
    "package_sha256",
    "host",
    "renderer",
    "adapter",
    "resolution",
    "process_id"
  ]
}
```

After the first render obtains a surface texture, submits the frame, and
returns `Ok(true)`, the process writes exactly one line and flushes stdout:

```text
UNONE_NATIVE_READY {"contract":"unone.native-ready.v1","package_sha256":"<sha256>","host":"windows","renderer":"wgpu-native-instanced","adapter":"<wgpu adapter info>","resolution":[1280,720],"process_id":1234}
```

The JSON object is the readiness payload. `package_sha256` is the SHA-256 of
the packaged `export.json`; `adapter` and `resolution` describe the active
renderer and surface; `process_id` identifies the child process. Hosts should
match the prefix first, then validate the contract and required fields.

Headless runs never emit a readiness line. No readiness line is emitted before
a surface exists, when surface acquisition returns `Ok(false)`, or when
renderer/runtime setup fails.
The existing final `UNONE_NATIVE_REPORT` line remains unchanged and is not the
readiness handshake.

## Save persistence

Readiness does not wait for storage. The save file is read before `Game.start`,
so an unavailable per-user data directory, an unreadable file or invalid JSON
fails startup (`NATIVE_SAVE_LOCATION_UNAVAILABLE`, `NATIVE_SAVE_READ_FAILED`,
`NATIVE_SAVE_CORRUPT`) before any surface exists, and no readiness line is
emitted. A failed write (`NATIVE_SAVE_WRITE_FAILED`) stops the player like any
other tick failure. `--describe` declares the `unone.native-save.v1` contract
under `save`, and the final report's `save` object carries the resolved `path`.
Replay, headless and measurement runs keep persistence off unless a test passes
`--save <path>`; see [player export](player-export.md) for locations and rules.
