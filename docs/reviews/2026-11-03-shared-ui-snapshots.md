# Shared UI snapshot generations: actual Core and WASM validation

The engine now retains a validated `Arc<UiTree>` when capturing observations,
rollback state and snapshots. Authored publication installs a fresh validated
generation; developer edits and retained-resource usage changes use copy-on-write.
This is a reusable engine ownership primitive, independent of game rules. Old
snapshots preserve their own UI and resource generations, and sharing exposes no
writable Luau table or buffer alias. See [ADR 0051](../decisions/0051-shared-ui-snapshot-generations.md).

The implementation is commit `0e75031`; matching baseline `5d7da387` and candidate
`9c773e3` artifacts passed [official Web CI](https://github.com/Ovan741852/Unone/actions/runs/41490065996).
Actual Linux Core execution passed seven ownership tests, 391 library tests
(three explicit manual tests ignored) and nine retained-image tests. Linux Native
all-target checking also compiled the borrow adapters. Both source revisions'
production and phase artifacts passed emitted ABI checks and actual CLI/export/WASM
parity. The earlier failed run remains recorded as a verifier working-directory
failure, rather than accepted parity evidence. See [Core/CI evidence](../evidence/2026-11-03-shared-ui/core-ci-summary.json).

The candidate production WASM passed the actual immutable bytes/span fixture:
353 checks and 69 rejection cases, including fresh-load isolation. A separate
natural-pressure lifetime test kept the root alive while its span was retained,
then witnessed both collect after release. Ten Sprite API transaction cases also
passed with recorded host receipts. Every initialized runtime was unloaded, with
no stderr or abort. These are bounded lifetime/API checks, not global leak or
GC-frequency certification. See [WASM regression evidence](../evidence/2026-11-03-shared-ui/wasm-regressions.json).

The synthetic production A/B uses a real bundled UI package and inline image
quads, not thousands of ordinary text leaves. Fresh-process ABBA and reverse-order
runs preserve every matched digest and final World/UI/save. Static 8192-quad total
command timing improved about 4%; the changing-root case improved about 1%.
These complete-command timings cannot isolate Rust cloning. See
[production measurements](../evidence/2026-11-03-shared-ui/synthetic-production-ab.json).

The matching phase artifacts provide the narrower result: on the frozen battle
workload, UI clone time fell from about 2.53 ms to 0.073 ms **in total across 300
ticks**, saving only about 0.0082 ms per tick. All 367 digest checkpoints and full
final World/UI/save agree across four fresh runtimes. Recurring slow frames spend
most of their time inside the script/update span; frame 146 records roughly
13–14 ms there and about 0.3 ms in UI conversion/validation. The enclosing script
span also includes other engine bindings, so it is not a pure-Luau CPU measure.
Occasional separate
host UTF-8 wall spans remain unattributed. These observations do not identify a
particular function or establish GC as the cause. See
[phase measurements](../evidence/2026-11-03-shared-ui/battle-phase-ab.json).

An additional matching opt2 sampling artifact from successful CI run
`41498233443` completed three fresh VMs with profiling off, VM probes, and function
sampling. Every digest and full final state also match all four earlier phase
runs. On the same **old frozen R2** workload, safe-point stacks identify
`Settlement.passable -> sbPath -> sbAgentStep` as an allocation-review candidate.
The probes record about 98.4 MB of cumulative positive allocation requests in
300 ticks. Several slow frames contain 2–4 ms of summed incremental-step wall
time, despite short individual steps. Step counts are not collection counts;
growth is not live heap; full collections, Rust allocations and JS GC remain
unmeasured. Instrumentation changes timings and this old workload cannot identify
current Game bottlenecks. See [sampler evidence](../evidence/2026-11-03-shared-ui/battle-sampler.json).

The official host adds an optional `unone_performance_feed=1` DOM-only diagnostic
for tools that cannot access page JS globals. It publishes bounded, paired RAF
samples after the existing callback endpoint, at most twice per second. Its own
wall cost is reported in the next envelope. It installs no timer, runtime control
or gameplay API; the default remains off. Feed failure or teardown cannot block
game cleanup, including a throwing diagnostic DOM sink. This is a reusable host
observation primitive, not Game presentation or an FPS acceptance result. The
[export contract](../player-export.md) specifies freshness and observer limits.

Independent Codex source reviews found no remaining concrete P1/P2 in the Arc/COW
change. A separate tool-free Claude Code 2.1.308 review of the fixed Core diff
`5d7da387..0e75031` timed out at 45 seconds with empty stdout/stderr and remains
incomplete. Its exact command, source pins, fixed diff and result are preserved
in [the review record](../evidence/2026-11-03-shared-ui/claude-review.json). Source
review is separate from the actual tests and performance results above.

The JYRogue performance regression is still open. The Arc change is not a
demonstrated battle-tail fix. Other chats/system work can run concurrently;
coordinated timing windows and diagnostics retain that limitation. A minimized
desktop browser throttled a new official-player resource run; its startup and
partial rendering are not FPS or completed lifecycle acceptance. The previous
bounded official-player lifecycle acceptance remains historical evidence for its
own runtime/host pair.

Windows Native's final rebuild and matching Windows CLI remain blocked by App
Control error 4551. No blocked executable was retried, relocated or renamed, and
no OS security policy was changed. Linux Core checks and WASM execution do not
substitute for that Windows Native player validation. No complete SDK delivery,
seven-scene stable-60-FPS result, universal absence of memory leaks, or acceptable
GC frequency is claimed.
