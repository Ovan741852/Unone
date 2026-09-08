# Independent review of Worker/ECS next steps

The reviewer received the two proposal documents and repository, with no main
agent conclusion or conversation history. It inspected implementation and made
no edits. Verdict: direction plausible, **formal Worker/WASM compute not yet
approved; ECS deferred**. A contract model and equivalent-kernel measurement
experiment are acceptable next steps.

Blocking findings:

1. `EngineRuntime::tick`, Web scheduling and Developer Step synchronously complete
   a tick today. N+1 asynchronous delivery requires a ready/pending/fault host
   boundary, frozen input and revised completion accounting; submit/take alone
   cannot implement it.
2. Runtime generation misses gameplay reset within the same runtime. Cancel,
   reset, failed/successful reload, initial submission and retained results need
   one lifecycle contract.
3. Per-job caps do not bound total queue/results/module memory. Interruption must
   cover instantiate/start, ABI calls, allocation, compute and free. Cleanup traps
   require executor disposal, not indefinite "free exactly once" attempts.
4. Prose layouts cannot drive the promised ABI validation and AI discovery.
   Machine-readable layout and compiled/enabled/executor capabilities are prerequisites.
5. Legion Fall's regional, bounded, team/air-qualified 2D targeting is not the
   proposed generic 3D nearest kernel. Parallel frozen inputs also differ from
   the current in-place positions. A faster unrelated kernel proves no game gain.
6. No comparative component lookup/query evidence currently supports ECS.

Response: implement only the isolated [executable job contract model](../../experiments/compute-contract/README.md).
It makes lifecycle, pending input, pause/step and bounded retained payload choices
testable. Production runtime, ProjectConfig and callable API discovery remain
unchanged. Executor safety, actual browser responsiveness, cross-host delivery
and kernel benefit remain separate unpassed gates. Do not count model tests as
passing those gates.

The independent implementation re-review initially rejected the model: Node
`Buffer.slice()` aliased supposedly frozen input and output. This was reproduced,
fixed with owned `Uint8Array` copies and hashing of copied bytes, and covered by
actual Buffer-mutation regression tests (including dispatch-copy mutation).
The reviewer re-ran all **11 tests**, then approved the isolated model only.
It did not approve production Worker/WASM, host barrier, cross-host determinism,
total executor resource bounds, performance gains or ECS.
