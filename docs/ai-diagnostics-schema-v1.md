# AI diagnostics and replay contract v1 (design)

Status: design baseline for schema review. The CLI, MCP tools, Core hooks, and
Luau adapters described here are not implemented yet. This document is not a
gameplay specification and does not move game rules into Rust.

## 1. Version and ownership

The wire formats use JSON Schema Draft 2020-12. The diagnostic tool/plugin
owns validation, storage, query, trace expansion, bundle import/export, and
replay orchestration. Core may provide a non-mutating emit hook and stable
tick/sequence context. A game written in Luau owns its flags, invariants,
scenario JSON Schema, and capture/restore adapter.

## 2. Flag registry

`unone.diagnostics.flags.v1` is a versioned source-map registry. Flag IDs are
semantic and must not contain line numbers. A registry is bound to both a
human release label and the exact canonical source hash.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://unone.dev/schemas/unone.diagnostics.flags.v1.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "registryVersion", "gameId", "gameRevision", "scriptHash", "flags"],
  "properties": {
    "schemaVersion": {"const": 1},
    "registryVersion": {"type": "string", "minLength": 1},
    "gameId": {"type": "string", "minLength": 1},
    "gameRevision": {"type": "string", "minLength": 1},
    "scriptHash": {"$ref": "#/$defs/hash"},
    "flags": {"type": "array", "items": {"$ref": "#/$defs/flag"}}
  },
  "$defs": {
    "hash": {"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"},
    "flag": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "summary", "owner", "severityDefault", "sourceMap"],
      "properties": {
        "id": {"type": "string", "pattern": "^[a-z][a-z0-9]*(\\.[a-z0-9_-]+)+$"},
        "summary": {"type": "string", "minLength": 1},
        "owner": {"type": "string", "minLength": 1},
        "severityDefault": {"enum": ["debug", "info", "warning", "error", "fatal"]},
        "sourceMap": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/source"}},
        "invariants": {"type": "array", "items": {"type": "string"}}
      }
    },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": ["file", "function", "lineStart", "lineEnd", "revision", "scriptHash"],
      "properties": {
        "file": {"type": "string", "minLength": 1},
        "function": {"type": "string", "minLength": 1},
        "lineStart": {"type": "integer", "minimum": 1},
        "lineEnd": {"type": "integer", "minimum": 1},
        "revision": {"type": "string", "minLength": 1},
        "scriptHash": {"$ref": "#/$defs/hash"},
        "fileHash": {"$ref": "#/$defs/hash"}
      }
    }
  }
}
```

The tool resolves a source map only when `gameId`, `gameRevision`, and
`scriptHash` match. An old registry remains queryable for old events; a new
registry may retain the same flag ID with a new source map. An unknown flag is
`DIAGNOSTIC_FLAG_UNKNOWN`; a known flag with a mismatched revision/hash is
`DIAGNOSTIC_FLAG_STALE_SOURCE`. A changed line number is therefore harmless,
while using a new file hash as if it were the old source is not.

## 3. Canonical source and asset fingerprints

`game.scriptHash` is not just the hash of `main.luau` when the game imports
other modules. The publisher creates a canonical source manifest:

```json
{
  "schemaVersion": 1,
  "files": [
    {"path": "scripts/main.luau", "sha256": "..."},
    {"path": "scripts/economy.luau", "sha256": "..."}
  ],
  "entrypoints": ["scripts/main.luau"]
}
```

Paths are project-relative, normalized, sorted, and encoded as UTF-8. The
`scriptHash` is the SHA-256 of this canonical manifest; each source-map entry
may additionally carry its individual `fileHash`. Imported assets are covered
by the separate content-addressed `assets.manifestHash`; scenario schema bytes
have their own `scenarioSchema.hash`. `activeGenerationEvidence` is retained
only as local provenance and never participates in exact-version matching.

## 4. Reproduction envelope

The complete machine-readable contract is `unone.reproduction.v1`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://unone.dev/schemas/unone.reproduction.v1.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "mode", "game", "engine", "assets", "scenarioSchema", "captureOrigin", "scenario", "inputs", "expected", "adapter"],
  "properties": {
    "schemaVersion": {"const": 1},
    "mode": {"enum": ["exact_version", "compatible_version"]},
    "game": {"$ref": "#/$defs/game"},
    "engine": {"$ref": "#/$defs/engine"},
    "assets": {"$ref": "#/$defs/assets"},
    "scenarioSchema": {"$ref": "#/$defs/scenarioSchema"},
    "captureOrigin": {"oneOf": [{"$ref": "#/$defs/start"}, {"$ref": "#/$defs/checkpoint"}]},
    "seed": {"type": "string", "pattern": "^[0-9]+$"},
    "rngState": {},
    "scenario": {"type": "object"},
    "initialState": {},
    "inputs": {"$ref": "#/$defs/inputs"},
    "expected": {"oneOf": [{"$ref": "#/$defs/expectedDiagnostic"}, {"$ref": "#/$defs/expectedInvariant"}]},
    "adapter": {"$ref": "#/$defs/adapter"}
  },
  "allOf": [{
    "if": {"properties": {"captureOrigin": {"properties": {"kind": {"const": "checkpoint"}}}}},
    "then": {
      "anyOf": [
        {"required": ["rngState"], "properties": {"rngState": {"not": {"type": "null"}}}},
        {"required": ["initialState"], "properties": {"initialState": {"not": {"type": "null"}}}}
      ]
    }
  }],
  "$defs": {
    "hash": {"type": "string", "pattern": "^sha256:[0-9a-f]{64}$"},
    "nonEmpty": {"type": "string", "minLength": 1},
    "game": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "revision", "scriptHash"],
      "properties": {"id": {"$ref": "#/$defs/nonEmpty"}, "revision": {"$ref": "#/$defs/nonEmpty"}, "scriptHash": {"$ref": "#/$defs/hash"}}
    },
    "engine": {
      "type": "object", "additionalProperties": false,
      "required": ["version", "coreRevision"],
      "properties": {"version": {"$ref": "#/$defs/nonEmpty"}, "coreRevision": {"$ref": "#/$defs/nonEmpty"}}
    },
    "assets": {
      "type": "object", "additionalProperties": false,
      "required": ["manifestHash"],
      "properties": {"manifestHash": {"$ref": "#/$defs/hash"}, "activeGenerationEvidence": {"type": "integer", "minimum": 0}}
    },
    "scenarioSchema": {
      "type": "object", "additionalProperties": false,
      "required": ["schemaRef", "id", "version", "hash"],
      "properties": {"schemaRef": {"$ref": "#/$defs/nonEmpty"}, "id": {"$ref": "#/$defs/nonEmpty"}, "version": {"type": "integer", "minimum": 1}, "hash": {"$ref": "#/$defs/hash"}}
    },
    "start": {"type": "object", "additionalProperties": false, "required": ["kind"], "properties": {"kind": {"const": "start"}}},
    "checkpoint": {
      "type": "object", "additionalProperties": false,
      "required": ["kind", "tick", "rngOwnership"],
      "properties": {
        "kind": {"const": "checkpoint"}, "tick": {"type": "integer", "minimum": 0},
        "frame": {"type": "integer", "minimum": 0},
        "rngOwnership": {"enum": ["core_rng", "game_rng", "core_and_game_rng"]}
      }
    },
    "inputs": {
      "type": "object", "additionalProperties": false,
      "required": ["frames", "complete", "truncated"],
      "properties": {"frames": {"type": "array", "items": {"type": "object"}}, "complete": {"type": "boolean"}, "truncated": {"type": "boolean"}}
    },
    "endCondition": {
      "oneOf": [
        {
          "type": "object", "additionalProperties": false,
          "required": ["kind", "tick"],
          "properties": {"kind": {"const": "after_tick"}, "tick": {"type": "integer", "minimum": 0}}
        },
        {
          "type": "object", "additionalProperties": false,
          "required": ["kind", "renderFrame"],
          "properties": {"kind": {"const": "after_render_frame"}, "renderFrame": {"type": "integer", "minimum": 0}}
        },
        {
          "type": "object", "additionalProperties": false,
          "required": ["kind", "flag"],
          "properties": {"kind": {"const": "terminal"}, "flag": {"type": "string", "minLength": 1}}
        }
      ]
    },
    "expectedDiagnostic": {
      "type": "object", "additionalProperties": false,
      "required": ["kind", "code", "flag", "endCondition"],
      "properties": {"kind": {"const": "diagnostic"}, "code": {"$ref": "#/$defs/nonEmpty"}, "flag": {"$ref": "#/$defs/nonEmpty"}, "endCondition": {"$ref": "#/$defs/endCondition"}}
    },
    "expectedInvariant": {
      "type": "object", "additionalProperties": false,
      "required": ["kind", "id", "expectedValue", "endCondition"],
      "properties": {"kind": {"const": "invariant"}, "id": {"$ref": "#/$defs/nonEmpty"}, "expectedValue": {}, "endCondition": {"$ref": "#/$defs/endCondition"}}
    },
    "adapter": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "version"],
      "properties": {"id": {"$ref": "#/$defs/nonEmpty"}, "version": {"$ref": "#/$defs/nonEmpty"}}
    }
  }
}
```

Semantic validation supplements the schema:

- `checkpoint` requires a matching `rngState` or complete save payload; a
  `start` capture may omit `initialState`.
- `endCondition.kind` determines the evaluation point. Replay ordering uses
  `(tick, sequence)` only; `renderFrame` and wall-clock time are explanatory.
- `exact_version` compares engine/core revision, game canonical script hash,
  scenario-schema hash, asset manifest hash, and registered adapter version.
  It does not compare `activeGenerationEvidence`.
- `compatible_version` is allowed only when the registered adapter and schema
  registry declare compatibility. The original envelope is immutable;
  `expectedOverride` and `regressionChecks` are request-only values.

## 5. Diagnostic event and replay result

An event source always contains `revision`, `scriptHash`, and optionally a
per-file hash. `tick` is the fixed simulation step; `sequence` orders events
inside one tick. `renderFrame` is optional host presentation count and never
controls deterministic replay.

```json
{
  "schemaVersion": 1,
  "eventId": "evt_000042",
  "traceId": "trace_000007",
  "parentEventId": "evt_000041",
  "tick": 120,
  "sequence": 3,
  "renderFrame": 118,
  "flag": "game.economy.refund.apply",
  "code": "ECONOMY_REFUND_DUPLICATE",
  "severity": "error",
  "source": {"file":"scripts/economy.luau", "function":"refund", "line":132, "revision":"release-42", "scriptHash":"sha256:..."},
  "context": {"entityId":"player-1", "operation":"refund"},
  "facts": [{"name":"refundAlreadyApplied", "value":true}],
  "likelyCauses": [],
  "suggestedActions": [{"action":"diagnostics.trace", "command":"game diagnostics trace --trace trace_000007"}],
  "payload": {"expected": 100, "actual": 0}
}
```

`facts` are observed, `likelyCauses` are hypotheses, and
`suggestedActions` are executable next steps. A replay response must include:

```json
{
  "status": "not_reproduced",
  "sourceFingerprint": {"gameScriptHash":"sha256:...", "assetManifestHash":"sha256:...", "engine":"0.1.0"},
  "targetFingerprint": {"gameScriptHash":"sha256:...", "assetManifestHash":"sha256:...", "engine":"0.1.0"},
  "originalMatcher": {"kind":"diagnostic", "matched":false, "evaluatedAtTick":120},
  "regressionChecks": [{"id":"refund.balance_unchanged", "status":"passed"}],
  "regressionStatus": "passed",
  "reason": "old diagnostic no longer occurred; new invariant passed"
}
```

`status` is one of `reproduced`, `not_reproduced`, `incompatible`,
`incomplete`, or `execution_failed`. A timeout or `maxTicks` reached before
the end condition is `incomplete`, never `not_reproduced`. A runtime crash is
`execution_failed`. `not_reproduced` means the end condition was reached and
the original matcher did not occur. `regressionStatus=passed` is permitted
only when at least one requested check reached its evaluation point and every
requested check passed; otherwise it is `not_evaluated`, `failed`, or
`incomplete`.

## 6. Replay request and CLI/MCP surface

The request selects the target explicitly while preserving the source
reproduction:

```json
{
  "reproductionId": "rep_0007",
  "target": {"gameScriptHash":"sha256:...", "assetManifestHash":"sha256:...", "engine":"0.1.0", "adapter":{"id":"ashen-legion.scenario-adapter", "version":"1.2.0"}},
  "mode": "compatible_version",
  "expectedOverride": {"kind":"invariant", "id":"refund.balance_unchanged", "expectedValue":true, "endCondition":{"kind":"after_tick", "tick":120}},
  "regressionChecks": [{"id":"refund.balance_unchanged"}],
  "maxTicks": 600,
  "timeoutMs": 5000
}
```

The planned CLI/MCP calls are:

| Purpose | CLI | MCP | Mutation |
| --- | --- | --- | --- |
| Register flags | `game diagnostics flags register --file <registry.json>` | `unone_diagnostics_flags_register` | isolated registry write |
| Emit fixture event | `game diagnostics emit --file <event.json>` | `unone_diagnostics_emit` | diagnostic store write |
| Query summary | `game diagnostics query [filters] --cursor <c> --byte-budget <n>` | `unone_diagnostics_query` | read-only |
| Expand trace | `game diagnostics trace --trace <id> --cursor <c> --byte-budget <n>` | `unone_diagnostics_trace` | read-only |
| Replay | `game diagnostics replay --reproduction <id> --target ... --mode ... --max-ticks <n> --timeout-ms <n>` | `unone_diagnostics_replay` | isolated output only |
| Export/import evidence | `game diagnostics bundle export ...` / `import --file <bundle> --root <isolated-root>` | `unone_diagnostics_bundle_export/import` | staging only |

Query and trace always return a bounded summary first, a cursor, byte budget,
and `truncated`. Replay never mutates the source reproduction or production
save namespace. Bundle import checks every attachment and extracted path is
contained by the requested isolated root.

## 7. Luau adapter signatures

These are the planned typed shapes, not existing APIs:

```lua
type FlagSource = {
    file: string, functionName: string, line: number,
    revision: string, scriptHash: string,
}
type DiagnosticInput = {
    flag: string, code: string, severity: string?, source: FlagSource?,
    expected: any?, actual: any?, context: {[string]: any}?, payload: any?,
}
type EmitResult = {eventId: string, traceId: string, accepted: boolean}

diagnostics.registerFlag(flagId: string, summary: string, source: FlagSource): boolean
diagnostics.emit(input: DiagnosticInput): EmitResult

type ScenarioCapture = {
    schemaRef: string, schemaVersion: number, scenario: {[string]: any},
    origin: "start" | "checkpoint", tick: number?, frame: number?,
    rngOwnership: "core_rng" | "game_rng" | "core_and_game_rng"?,
    rngState: any?, save: any?, inputsComplete: boolean,
}
diagnostics.captureScenario(input: ScenarioCapture): string
diagnostics.restoreScenario(reproductionId: string): boolean
```

The adapter itself is selected by registered ID/version in the envelope. JSON
never contains executable capture/restore code. A game without an adapter may
still emit and query diagnostics, but replay is `incomplete` with an explicit
`not_replayable` reason.

## 8. Bounded storage and error codes

The MVP store has global `maxBytes`, `maxEvents`, `maxTraces`, and
`maxTombstones`, plus a per-trace event cap. Tombstones consume the same global
byte/event budget. When the tombstone cap is full, counters may be merged into
an aggregate tombstone with `droppedTraces`, `droppedEvents`, and
`droppedBytes`; trace IDs are not retained forever. Ordinary fingerprint
aggregation keeps `count`, first/last timestamps, and first/representative
event IDs. Root/error/parent events are protected from ordinary aggregation,
but a whole trace segment may still be evicted and must leave a tombstone.

The initial error-code set is:

`DIAGNOSTIC_FLAG_UNKNOWN`, `DIAGNOSTIC_FLAG_STALE_SOURCE`,
`DIAGNOSTIC_SCHEMA_INVALID` (input rejection with JSON Pointer),
`DIAGNOSTIC_SCHEMA_INCOMPATIBLE`, `DIAGNOSTIC_ASSET_MISSING`,
`DIAGNOSTIC_REPLAY_INCOMPLETE`, `DIAGNOSTIC_REPLAY_INCOMPATIBLE`,
`DIAGNOSTIC_REPLAY_NOT_REPRODUCED`, `DIAGNOSTIC_REPLAY_EXECUTION_FAILED`,
`DIAGNOSTIC_BUFFER_TRUNCATED`.

## 9. Minimal fixtures

### Valid start capture

```json
{
  "schemaVersion": 1, "mode": "exact_version",
  "game": {"id":"ashen-legion", "revision":"release-42", "scriptHash":"sha256:0000000000000000000000000000000000000000000000000000000000000000"},
  "engine": {"version":"0.1.0", "coreRevision":"git:abc"},
  "assets": {"manifestHash":"sha256:1111111111111111111111111111111111111111111111111111111111111111"},
  "scenarioSchema": {"schemaRef":"schema://ashen-legion/scenario/v1", "id":"ashen-legion.scenario", "version":1, "hash":"sha256:2222222222222222222222222222222222222222222222222222222222222222"},
  "captureOrigin": {"kind":"start"}, "scenario": {"wave":1},
  "inputs": {"frames":[], "complete":true, "truncated":false},
  "expected": {"kind":"diagnostic", "code":"ECONOMY_REFUND_DUPLICATE", "flag":"game.economy.refund.apply", "endCondition":{"kind":"after_tick", "tick":120}},
  "adapter": {"id":"ashen-legion.scenario-adapter", "version":"1.2.0"}
}
```

### Invalid fixtures and required outcomes

| Fixture | Required result |
| --- | --- |
| `expected: {"code":"X"}` without `kind`, `flag`, or end condition | `DIAGNOSTIC_SCHEMA_INVALID` with JSON Pointer `/expected` |
| `expected.endCondition.kind=terminal` without a `flag` | `DIAGNOSTIC_SCHEMA_INVALID` with JSON Pointer `/expected/endCondition` |
| valid JSON but unknown `schemaRef` or mismatched schema hash | `DIAGNOSTIC_SCHEMA_INCOMPATIBLE` |
| `captureOrigin.kind=checkpoint` without tick and non-null RNG/save state | `DIAGNOSTIC_SCHEMA_INVALID` at `/captureOrigin` or `DIAGNOSTIC_REPLAY_INCOMPLETE` when the capture is incomplete |
| truncated inputs or timeout before end condition | `DIAGNOSTIC_REPLAY_INCOMPLETE` |
| missing asset content hash | `DIAGNOSTIC_ASSET_MISSING` |
| unexpected runtime crash | `DIAGNOSTIC_REPLAY_EXECUTION_FAILED` |
| end condition reached but expected diagnostic absent | `DIAGNOSTIC_REPLAY_NOT_REPRODUCED` |

These fixtures provide the smallest path from Luau `emit` to AI query, trace,
and replay without inventing a second simulation or treating startup success as
proof of reproduction.
