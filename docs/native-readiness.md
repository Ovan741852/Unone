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
