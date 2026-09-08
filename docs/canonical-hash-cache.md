# Canonical SHA-256 prefix reuse

The Web player still serializes the complete canonical world on every publication and returns the same `sha256:` digest. No field is omitted and no tick is exempt from verification. CLI canonical hashing remains the independent full-hash reference.

`CanonicalHasher` retains exact input bytes and intermediate SHA-256 states at 16 KiB boundaries. On the next publication it compares blocks byte-for-byte, reuses only the contiguous identical prefix, and hashes everything after it. It does not trust instance revision numbers, pointers, object identity, schema order or a hash of a hash. Arbitrary edits, including growth, shrinkage and changes in the middle of a string, produce the same result as hashing the complete byte sequence.

The maximum retained prefix is 4 MiB, plus at most 256 SHA states and allocation bookkeeping. The cache keeps capacity when the world shrinks; a successful project load resets it. Unchanged large prefixes benefit most. An entirely changing prefix still requires full hashing and incurs comparison/copy overhead; this is not a universal speedup guarantee. The live bridge and production player share the implementation.

Development `profile.start` / `profile.stop` windows expose `publication.phases`:

- `canonical_encode_ms`: serialize the canonical world.
- `canonical_hash_ms`: exact prefix comparison, SHA work and cache maintenance.
- `presentation_ms`: construct the memory-descriptor presentation view.
- `envelope_ms`: encode/store the final response and replace retained presentation allocations.

These spans exclude simulation, initial snapshot capture and browser JSON decoding. They count successful world publications, including explicit transport/save republishing, so publications need not equal ticks. Native hosts return `publication: null` because they do not use this Web publication path. Production has no profiling request ABI or publication timers.

`publication.hash_work` records cumulative input, reused and hashed bytes, cache-hit publications, the prefix limit and the last measured cache allocation size. `input_bytes = reused_bytes + hashed_bytes`. Cache allocation size is from the last publication in the window, not a continuously updated process heap measurement. Timings and counters never enter Lua or canonical state.

Windows share the core profile ID, reset on successful start/load and freeze on stop or a Lua tick failure. At most 1,024 publication samples are retained for p95, while totals cover the full window. Native tests compare arbitrary byte edits with full SHA-256; exported-player replay tests compare every tick against the previous full-hash artifact. See the [third-round measurements](legion-fall-round3.md).
