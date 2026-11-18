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
cumulative `visible_ms` and `uncertain_ms` counters. A game using
`api.hostTime.sample` for idle catch-up must explicitly subtract only the
`visible_ms` delta in that same sample interval; uncertain time is not
evidence of a visible wait. A 250 ms heartbeat separates observed foreground
intervals from gaps over 1 second, and compares monotonic and wall clocks.
Hidden or host-paused segments are excluded according to delivered browser
lifecycle events. A stalled process can be misclassified as uncertain; neither
clock proves whether an unobserved OS suspension occurred, and whether
hostTime itself advances during device sleep is platform-dependent.
The host retries a failed tick with the same receipt, and acknowledges it only
after a successful tick. Counter values and the epoch are validated as safe,
monotonic integers. Legacy hosts, games and replays remain unchanged when this
option is absent. Use matching host JS, Core/WASM and game API declarations.

At 4K the staging RGBA target uses approximately 31.64 MiB, independent of the
on-demand depth attachment. Actual process/GPU memory and frame timing must be
measured on the target device; this feature does not promise a fixed reduction.

Explicit Retry re-prepares failed managed sprite callers without replacing
healthy callers, and retries mesh JSON or image load/header transport errors
through their failed owners. An invalid mesh or unsupported encoding remains
a terminal error. A failed image still retained by another broker owner may
remain unavailable; repeated failure must not be reported as ready, and the
player exposes reload as a recovery. The paused scheduler does not advance
the game while awaiting a retry.

<<<<<<< HEAD
=======
In development exports this opt-in disables single-step and manual input
injection, because an asynchronous queued step cannot safely be canceled after
input has been leased. The diagnostics are `PRESENTATION_STEP_UNSUPPORTED` and
`PRESENTATION_INPUT_UNSUPPORTED`; ordinary hosts retain both operations.
During an active wait, mutating tool invocations,
queued input, transport changes, and restart are rejected until recovery.
An invocation already dispatched before the wait cannot be retroactively
canceled. Read-only developer inspection remains available.
>>>>>>> aa95ed5 (Fence queued developer mutations at backend dispatch)
