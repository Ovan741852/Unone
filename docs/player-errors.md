# Outgoing Web player errors

The official player emits `unone-player-error` on its own `window`. This is an
engine contract, independent of any platform, SDK injection or telemetry service.
Native/Core callers already receive structured Diagnostic results. The Web host
exposes handled failures without needing an unhandled JavaScript rejection.

```js
window.addEventListener('unone-player-error', event => {
  if (event.detail.version === 1 && event.detail.fatal) myHost.report(event.detail);
});
```

Install before the player module to receive startup errors. Alternatively,
`window.unonePlayerErrors.subscribe(fn)` returns an unsubscribe function, catches
synchronous and asynchronous sink failures, and permits at most 32 subscriptions.
`last()` returns the latest frozen record or null. The API is installed before
asynchronous startup, cleared on restart and removed on teardown. DOM listeners
use normal browser event semantics; exceptions there are browser errors. A
cross-origin iframe host must bridge the event itself. The engine never contacts
a reporting server or posts to an arbitrary parent.

Protocol v1 is a flat immutable record: `version`, document-local `sequence`,
`severity` (error/warning), `fatal`, `code`, `phase` (startup/runtime), `backend`
(main/worker/unknown), `message` (at most 512 characters), optional `stack`
(technical basename/line frames, at most 2,048 characters), `file`, `line`,
`frame` and `causeCode`.

SCRIPT_ERROR_LIMIT preserves the terminal code and selects its last Luau error's
message, frame and source trace. Main and worker errors converge at the same
terminal boundary. The event precedes cleanup and occurs once per failure, so
cleanup failure cannot erase it. Restart permits a new terminal failure. Existing
scheduler stopping, console diagnostics and the stopped screen remain intact.

Recovery follows the authored error policy. Warnings use the existing per-kind
five-second throttle; hosts collecting crashes should filter `fatal === true`.
No thrown object, raw diagnostic envelope, arbitrary facts, saves or physical/
network packets are forwarded. Common credentials, URLs, local paths and email
patterns are masked. Game-authored error messages may contain application text;
hosts must apply their own data policy and regard client reports as unverified.

Tests: player-error-channel.test.mjs and player-errors.test.mjs. Also exercise an
actual failing Luau update in the official exported player on both backends: a
synthetic CustomEvent alone does not prove the runtime-to-host path.
