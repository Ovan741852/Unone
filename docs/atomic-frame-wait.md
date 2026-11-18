# Offline whole-frame presentation (experimental)

Web projects may explicitly declare `atomic_frame_wait` in their presentation
settings with `mode: "pause_offline"` and five localized `labels` fields:
`loading`, `delayed`, `error`, `retry`, and `reload`. Omission retains the
previous host behavior. This mode is for offline simulations only; it pauses
the complete scheduler while presentation is blocked, so it must not be used
for server-authoritative or networked gameplay. Network commands fail closed.

It requires the official WebGL renderer, `antialias: false`, and a
synchronized context. Checked raster, projected material profiles, external
render passes and Effekseer are incompatible and are rejected by preflight.
Runtime context capabilities may still cause a clear startup failure. World,
projected content and UI render into one reusable staging target; the native
IME, scroll and input route are published only after GPU submission. Resize,
context loss and uncertain GPU submission require an opaque recovery surface;
neither GPU submission nor a browser compositor guarantees physical scanout.

The recorded `api.input.getPresentationWait()` receipt carries an epoch and a
cumulative `visible_ms` counter. A game using `api.hostTime.sample` for idle
catch-up must explicitly subtract only the receipt delta in that same sample
interval. Hidden or host-paused segments are excluded according to delivered
browser lifecycle events; clocks cannot infer an unobserved OS suspension.
The host retries a failed tick with the same receipt, and acknowledges it only
after a successful tick. Counter values and the epoch are validated as safe,
monotonic integers. Legacy hosts, games and replays remain unchanged when this
option is absent. Use matching host JS, Core/WASM and game API declarations.

At 4K the staging RGBA target uses approximately 31.64 MiB, independent of the
on-demand depth attachment. Actual process/GPU memory and frame timing must be
measured on the target device; this feature does not promise a fixed reduction.
