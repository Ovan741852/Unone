# Network

`api.network` joins a room of sessions of a game and carries text between them, in order. The game owns
everything above that: the session, players, turns, timeouts, resends and what the text means.

```luau
api.network.open({room = "game-1"})          -- url optional
api.network.send("hello")                    -- up to 65536 bytes
local batch = api.input.getPhysicalBatch()   -- what arrives: rows of kind "network"
```

Rows: `open` (`peer` is this session's number), `peer_join`, `peer_leave`, `message` (`peer`, `data`),
`closed`, `error` (`data` says why). They are control rows of the ordered physical input, so a game needs
`ordered_physical_v1` and a replay has them; fixtures can supply them in tests. Native and test hosts carry
nothing.

The official Web player connects a WebSocket to the relay in `url`, else the page's `?relay=`, else
`ws://<page host>:8433`. Run one with `node scripts/net-relay.mjs [port]`: it forwards each session's text to
the others of its room and says who comes and goes. It does not persist anything, and it is not an
authentication or matchmaking service.
