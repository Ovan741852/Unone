# Decision 0020: save is an opaque game payload with a host storage boundary

## Context

AVG and later live games need to restore game-owned progress, but the engine must not own dialogue schema, player progression rules, migration policy, or platform file APIs. Reusing semantic observation as save state would make a read-only presentation projection accidentally become persistence state.

## Decision

Expose only `api.save.set(value)` and `api.save.get()` in the Luau contract:

- The value is a bounded JSON-like payload using the same serialization guard as semantic observation.
- The game owns the payload schema, version field, validation, and migration decisions.
- The engine retains the latest opaque payload in the runtime and exposes it to host adapters; host adapters own files, key-value stores, encryption, cloud sync, and atomic replacement.
- A host may inject a payload before the first tick; the game reads it during its normal update and decides whether to apply it.
- Save state survives script hot reload with the Rust-owned runtime, but engine reload never silently migrates or rewrites the payload.

## Non-goals

No save slots, cloud sync, encryption, database, schema registry, automatic migration, or gameplay-specific persistence helper is added to the engine until a validation game proves that a smaller boundary blocks it.

## Evidence

`EngineRuntime` has a host/Luau round-trip regression test. AVG uses a versioned `{version, node}` payload and a test manifest `load_save` case. The API descriptor documents when to use save versus observation.
