# Native preview surface-loss recovery observed during town development

Consumer: `_Games/wuxia-sandbox`, native tools 55433; presentation at 8088.

Observed CLI termination in this session:

```
unone preview: render failed: surface validation failed
```

The associated native tools listener disappeared, and the model worker's next observation request failed with WinError 10061. This is an actual process exit, unlike not-applicable memory fields. No stacktrace or reproducible trigger was captured; do not infer a proven renderer root cause.

Nearby observations: GPU memory reached about 15.8/16 GB with large NanoJev question batches. A separate launch-detection issue could also launch a second worker when the first used a relative script path; the consumer now uses a per-town OS file lock and records/validates the worker PID. Single-question forwards lowered sampled total GPU memory to about 8–10 GB; both are consumer-side changes, not an engine rendering fix.

Engine request: investigate/report the underlying surface error and consider reconfiguring/recovering a lost/invalid surface rather than taking down simulation and the diagnostic API. Keep this a reusable host primitive; no town rules belong in Rust. Add a test for tools-server availability or an explicit terminal error when rendering fails.

Delivery status: this issue is recorded locally. An attempt to list app threads for routing did not return and was cancelled; no successful message delivery to another Unone thread is claimed.
