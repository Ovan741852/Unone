# Host data

A trusted custom renderer can hand the game script one JSON value per channel each tick. Use it when the
Web side owns rules or networking (for example a room-authoritative game whose rules also run on a
server) and Luau draws: send the whole display state at once instead of encoding it as held actions.

```js
// custom renderer (web): options.hostActions from the official player
if (typeof hostActions.sendData === 'function') hostActions.sendData('game.state', view);
```

```luau
-- Luau: a table in the tick that consumed it, nil on other ticks
local view = api.input.getHostData("game.state")
if view then current = view end
```

## Rules

- **Latest state, not a queue.** `sendData` copies the value as JSON when it is called. A later send on the
  same channel before the next tick replaces it. Luau reads it in the successful tick that consumes it and
  gets `nil` on other ticks, so keep your own copy. A failed tick keeps it for the retry.
- **Not user input.** Pause, blur and releasing keys clear held actions and pointers, not host data.
- **Bounds.** At most 16 channels a tick. A channel name is 1–128 UTF-8 bytes, not blank, no control
  characters. Each value is at most 262144 bytes of JSON. Numbers arrive as binary64 numbers (as in
  observations); JSON `null` becomes `nil`, arrays become 1-based tables.
- **Errors at the boundary.** The Web side throws `HOST_DATA_INVALID` for a bad channel, a value that is
  not JSON or one that is too large, and `HOST_DATA_CHANNELS_FULL` for a 17th channel. The engine
  rejects a frame whose channel is not one JSON value with `INPUT_HOST_DATA_INVALID` and admits no part of it.
- **Recorded like input.** Host data is part of the input frame (`host_data`: channel → JSON text), so native
  tests, fixtures and replays supply it the same way:
  `{"host_data": {"game.state": "{\"players\":[]}"}}`.
- **Trusted only.** It is a capability of `options.hostActions`, not a global or a cross-origin message
  interface. Native and headless hosts receive it only from input frames.

`sendData` is optional in `hostActions` version 1: feature-detect it. Before it existed, renderers encoded
state as held packet bits (`setHeld`); that still works, but every held name is serialized into every tick.
