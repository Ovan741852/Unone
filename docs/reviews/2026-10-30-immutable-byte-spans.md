# Immutable byte spans: ownership and validation review

The reviewed change extends VM-frozen Luau buffers with genuinely bounded,
zero-copy spans. A span is still a native `buffer`, with its own logical length
and a strong GC reference to its ultimate frozen root. Safe Rust mlua writes
check the same readonly flag. This is a reusable binary-data primitive; it does
not encode gameplay, asset selection or a game's cache rules.

The scoped evidence and copied raw results are in
[source-review.json](../evidence/2026-10-30-immutable-bytes/source-review.json).
The clean `905e20e` emitted WASM, strict historical-fixture pairing and natural-GC
witness are recorded in
[acceptance.json](../evidence/2026-10-30-immutable-bytes/acceptance.json).
A matching release CLI and complete SDK remain blocked by Windows App Control.
This record does not establish stable FPS, global leak freedom or infrequent
natural GC.

## Findings and corrections

1. **Safe host mutation bypass.** The first VM-only implementation rejected
   Lua writes but upstream mlua `Buffer::write_bytes` and cursor writes could
   still mutate its payload. The mlua patch checks readonly under the same VM
   lock before constructing a mutable slice, validates write ranges before
   copying and preserves cursor position on rejection. The original host test
   compiled, but Windows App Control 4551 prevented its executable from starting.
   That attempt is preserved as **blocked, not an executed RED**.

2. **Coercing and unsafe range conversion.** Snapshot used coercing integer
   conversion and calculated a signed default length before checking its offset.
   The actual old `28df55e6…` WASM accepted fractional offset/length and a numeric
   string. Its tested `2^32` and `2^32+1` offsets/lengths were rejected: **overflow
   was not reproduced**. The original probe's aggregate `ok=false` and
   `red_reproduced=false` are retained, including its failed overflow expectation.
   New checks reject malformed numbers before casts and subtraction. The same
   policy covers standard buffer range/count arguments, VM fastcalls and native
   read lowering; write payload-value conversion retains upstream semantics.

3. **Missing bounded span.** The old emitted runtime rejected the actual probe
   because `api.bytes.span` was absent. The new buffer layout stores a logical
   data pointer and flattened root owner. Roots account for payload once; views
   allocate fixed metadata. GC marking, freeing, validation and graph diagnostics
   follow the owner edge. C API, interpreter and x64/A64 lowering use the logical
   pointer and length. `equals` and `equalsRange` compare bytes immediately on
   every call, without temporary strings, spans, hashes or memoization.

4. **Stale C++ build dependency.** A fresh no-preview/native-codegen test passed,
   but four default-feature public tests then failed at the malformed ordinary
   buffer read. `cc::Build::cargo_metadata(false)` and the absence of a C++ source
   watch allowed a previously built VM archive to be reused. The build now emits
   `cargo:rerun-if-changed` for its absolute `luau/` subtree, which Cargo watches
   recursively. The normal default command rebuilt Luau and passed. No cache
   deletion, executable rename or OS-policy workaround was used. A separate later
   C++-only edit/retrigger experiment was not run at this checkpoint.

## Executed gates

| Gate | Actual result | Scope |
|---|---|---|
| Frozen old WASM probe | Missing span and malformed-number acceptance observed | Old runtime metadata remains dirty `dab0e11…`; overflow expectation failed and remains recorded |
| Initial safe-host regression | Compiled; executable never started, error 4551 | No observed native baseline RED |
| First new compile attempt | Linker failed: `cannot find -lgcc_eh` | Separate from App Control; corrected normal `LIBRARY_PATH` |
| New no-preview Native R1 | 2 public + 7 host passed; 1 benchmark ignored | Windows x86_64, real compiled writer, dynamic reader and literal-NaN reader proved by private Proto-entry checks |
| Default-feature Native R1 | 4 public failed | Actual stale-archive regression retained |
| Default-feature Native R2 | 4 public + 6 host passed | Includes failed/successful reload; preview tools disable JIT in this build |
| Final no-preview Native rebuild | Never executed, error 4551 | New build helper was blocked; no new canonical report was emitted |
| New production WASM | 353 checks, 69 rejection cases passed | Clean `905e20e`, opt2 release, actual `c66a32bf…` WASM; initial, three ticks and unload/reset |
| Strict historical-fixture Native/WASM pair | Full world, observations, save and digest match at frames 0..3 | Unmodified actually executed Native R1 report and exactly reconstructed `65a7557e…` fixture; strict verifier unchanged |
| WASM natural-GC lifetime witness | Passed | Intermediate collected at frame 2 while child and root remain valid; last child released at frame 3, root and child collected at frame 4 |
| WASM operation diagnostic | 33 rows passed | Eleven operations, three sizes, paired raw/baseline timings; not an FPS or allocation-count gate |

The shared fixture exercises the full byte pattern, unaligned little-endian
reads, unsigned and signed 32-bit limits, independent view bounds, empty end
ranges, detached snapshots, direct comparisons, intrinsic shadowing, portable
save/observation rejection and retained nested views across fixed ticks. Host
tests additionally inspect adjusted data pointers, metadata-only allocation,
weak root/parent reachability, last-owner retirement and safe host mutation.
Unit-only explicit GC tests do not measure natural GC behavior.

Production R1's canonical report pins its own historical fixture. The later
comment and failure-diagnostic edits change that hash. Restoring exactly those
two lines reproduced the original `65a7557e…` hash; a separate actual new-WASM
run used that fixture and the unmodified R1 report through the strict pairing
gate. No expected hash, report or comparison was relaxed. The final `f1165619…`
fixture also passed separately in the new WASM. This does not turn the blocked
final Native rebuild into a pass. The updated assert diagnostic is evaluated
eagerly, so fixture timing/allocation equivalence is not claimed.

The natural-GC witness used weak references and 8 MiB of cumulative ephemeral
allocation, without calling a collector API. It verified every byte of a live
32 KiB nested view after its intermediate parent was collected, plus readonly
and logical-end rejection. After the last child reference was dropped, both
child and root weak references cleared. This proves the bounded view/root
lifetime case on the actual WASM VM; cumulative pressure is not retained heap
size and this test does not measure ordinary game GC frequency.

At 1 MiB backing size, creating a 512 KiB span measured about 63 ns versus
19.6 microseconds for copying that range. These are baseline-adjusted whole-tick
diagnostics on this shared machine, with normal Core/publication work and
natural GC active. Raw samples are retained; optimized Native operation
measurements remain unavailable.

The ops verifier was corrected before its actual run to warm each mode before
each measured round, matching the Native protocol. That test-tool correction is
committed after Core `905e20e`; the executed script capture exactly matches its
corrected source. The unchanged Core pin and verifier-source distinction are
recorded in [reproducibility.json](../evidence/2026-10-30-immutable-bytes/wasm/reproducibility.json).

WASM compilation succeeded in 2m51s. The build script's subsequent bootstrap
export gate failed because the existing old CLI lacks the committed
`sprite-cells.js` template inventory. The matching new release CLI build was
blocked with error 4551. Neither the outer script nor complete SDK delivery is
reported as passing; the existing SDK19 selection was preserved.

## Review disposition

Bounded independent Codex source reviews found no remaining concrete P1/P2 in
the reviewed VM ownership, GC/accounting, safe mlua mutation, codegen-address,
NaN-fallback and test-assertion scope after the corrections above. This is not a
full-engine audit. Concurrent asset/export/game changes are excluded.

The prescribed tool-free Claude CLI attempt used Claude Code **2.1.308**, a
fixed diff from `1f1219821a0bbe05b876ee3c2fe0b82485ff1b1a`, and captured source
pins at HEAD `5e69fd659c1186b90b8b88fa12c9285320332d81` plus working-tree postimages.
It timed out after **60.34 seconds**, exit 1, with **zero stdout and stderr**.
Its status is **incomplete**, with no findings disposition. The exact command,
version, result, fixed diff and supplied prompt are copied under
[`claude-incomplete/`](../evidence/2026-10-30-immutable-bytes/claude-incomplete/command.json).
Full large source postimages were not copied; their recorded hashes and the
actual supplied diff/prompt are retained. This capture predates the subsequent
C++ dependency-tracking fix and final fixture diagnostic wording.

## Limits

- A64 lowering is source-reviewed, not executed. Actual Node WASM execution is
  established; new worker/browser rendering is outside this record.
- Readonly is a VM runtime flag; the public Luau type remains `buffer`, so a
  write may type-check and then correctly fail at runtime.
- A small live span retains its whole backing root. This is explicit shared
  ownership rather than a promise to compact backing storage.
- Arbitrary unsafe C/FFI pointer writes and host writes into WASM linear memory
  retain their explicit unsafe authority and are outside the safe API guarantee.
- No matching final Native rebuild, indexed SDK handoff, optimized Native
  operation result, game-FPS conclusion, universal memory-leak absence or
  no-frequent-GC claim is made here.
