# Demand-sampled host time

`api.hostTime.sample(tag: string): number` is an explicit gameplay input, separate
from fixed update `dt` and detached performance measurements. The default is
disabled. Keep scheduling, game clock domains, offsets, conversion to u32 and
overflow comparisons in game Luau.

```json
{"host_time":{"mode":"live"}}
```

Live performs one synchronous monotonic read for **each** call. It returns floor
elapsed milliseconds from this runtime's creation before `Game.start`, within
0..9007199254740991. Equal consecutive values are valid. It never wraps. Floor
does not guarantee 1ms clock resolution, OS uptime, identical suspend behavior
across hosts, or equivalence to a media/network clock. Native and Emscripten use
the same engine `std::time::Instant` source. Live retains no session tape, only
the current transaction's last 32 samples for failure diagnostics.

Tags must be nonblank UTF-8 strings of at most 128 bytes. Sampling is legal only
inside start/update/onReload, including synchronous helpers invoked there.
Background jobs do not receive this capability. `os.clock/time/date` stay blocked.

## Recording and replay

```json
{"host_time":{"mode":"record","max_samples":1000000,"max_transactions":1000000}}
```

Both capacities default to 1000000 and must be 1..1000000. At 60 transactions/s
the transaction default spans about 4.6 hours; sample capacity may be reached
earlier (at 3 reads/tick, about 1.5 hours). Capacity exhaustion is terminal;
there is no ring buffer, dropping, automatic live fallback or implicit streaming.
Use live for ordinary indefinite gameplay. A storage-backed long recording API
is outside this primitive.

```json
{"host_time":{"mode":"replay","tape":{
  "schema_version":1,"source_epoch":"runtime-creation","transactions":[
    {"phase":"start","frame":0,"samples":[{"tag":"boot","milliseconds":12}]},
    {"phase":"tick","frame":0,"samples":[
      {"tag":"before","milliseconds":20},{"tag":"after","milliseconds":103}
    ]}
  ]
}}}
```

Schema 1 implies runtime-origin floor elapsed milliseconds, safe integer values,
no wrap. `source_epoch` is an opaque recording-host label (default
`runtime-creation`), **not** a globally unique runtime ID. A checkpoint should
bind the complete tape content hash plus cursor and its own host session identity.
The report's cursor is diagnostic; this API does not restore a mid-transaction
checkpoint or the entire game's state.

Replay performs no live source reads. It requires exact lifecycle phase, engine
frame, tag, order and read count. Missing samples, extra reads, unused samples or
transactions and unsafe/decreasing timestamps fail closed. Timestamps may equal
each other. `host_time_replay_complete()` / ABI `complete` validates the tape end.

`game replay record` selects record **before start** for a live project and saves
the tape in the recording's optional `host_time` field. `replay diff` selects replay
before start. An enabled-clock recording without a tape is rejected; no hidden
resampling occurs. Old disabled-clock schema-1 recordings remain compatible.
These are SDK replay inputs, not any particular game's original save/demo format.

Developer sessions also select record before start, export `host_time` with their
command recording, and require that tape on replay. A failed clock transaction
cannot be exported as a successful committed recording. Deterministic tests and
UI preview reject `live`/`record` policies; provide an explicit project replay
tape, including startup samples. Tests require complete consumption of that tape.

## Lifecycle and faults

Ordinary tick is not an all-World/Luau rollback transaction. A failed enabled-clock
tick retains its consumed sample tail/attempt, leaves the last successful tape
prefix intact and makes the clock terminal. Even a script `pcall` cannot hide a
clock mismatch from transaction completion. Further tick/reload requires a full
runtime load. This does not claim to repair partial game state.

A healthy hot-reload candidate has private tape/cursor/state and the same time
origin. Rejection discards candidate state, success commits it. Actual monotonic
reads performed by a rejected candidate cannot be undone: detached physical read
count includes them, and elapsed live time continues. A reload that samples time
must be included in a full external replay lifecycle; ordinary SDK record/diff
only records a new start followed by ticks.

`host_time_report()` and `host_time_tape()` never sample or advance a cursor.
Clock diagnostics/tapes do not automatically enter `WorldSnapshot` or its digest.
Published game observations and state influenced by samples do enter the digest.

The official Web runtime exposes readonly requests via
`backend.request({kind:'hostTime',request:{kind:'report'|'tape'|'complete'}})`.
The same transport works on main and worker backends. It uses
`unone_web_host_time_request` and the existing owned allocation/output ABI; no
browser clock is sampled once per render on behalf of all gameplay reads.
