# Core AI-native audit — 2026-09-11

Scope: **Unone Core's public CLI + persistent developer protocol on the existing Windows x64 executable**, using an isolated starter and the published replay/memory fixture. This is not a score for Scout itself, all engine subsystems, visual quality, other platforms, the optional npm SDK wrapper, or commercial readiness.

The user requested a Scout assessment and optimization if the result is too low. We use the existing `org.unone.ai-native` Scout entry and its unchanged ten-question rubric v1.0.0, with the previous **80/100** threshold. No gameplay behavior is moved into Rust. Viewer, accounts, real games and running services are untouched.

## Review decision

Evidence-supported score: **85.5/100**, above the requested 80-point threshold. The Scout evaluator accepts all ten ratings and returns `supported_within_scope`; an independent informed semantic review found no required score reduction, with wording corrections incorporated below. See the final [audit](audit.json), [evaluation](evaluation.json) and [semantic review](semantic-review.md).

The tested development loop is already above the requested threshold. **No Core runtime/CLI implementation was changed just to raise this score.** The useful next improvement is smaller, purpose-based discovery, not another memory tool or a larger runtime abstraction. The records below preserve the specific shortcomings so they do not become repeated speculative work.

| Check | Weight | Rating / 4 | Points | Evidence and remaining limits |
|---|---:|---:|---:|---|
| Purpose / starting point | 10 | 3 | 7.5 | README → workflow/session docs → init. New empty project initially fails the documented capabilities-first ordering. |
| Capability discovery | 10 | 3 | 7.5 | Actual compiled/project/host scopes are discoverable; renderer remains explicitly not probed. Purpose search is broad and fragmented. |
| Operation contract | 12 | 4 | 12 | Generated schema + public example; valid input, unknown-field rejection and repair, temporary dry-run/commit, actual state checked. |
| Context / source of truth | 10 | 3 | 7.5 | Stable entity/session IDs, revision, script digest, executable/game/assets fingerprints. Does not claim design/requirements tracking belongs in Core. |
| Observation | 10 | 4 | 10 | Snapshot, watch pagination, before/after diffs, replay result and unchanged original session verified. Semantic state is not proof of pixels. |
| Diagnostics | 14 | 3 | 10.5 | Wrong field / stale revision / session mismatch / executable mismatch give usable reasons and repair paths; some structured facts/actions remain empty. |
| Recovery | 10 | 4 | 10 | Same stale step rejected without double tick; resume watch with next_cursor; reopen resets transient state. Not durable cross-process resume or a request-result cache. |
| Scope / boundaries | 10 | 4 | 10 | Init refuses overwrite, old session rejected, dry-run does not commit, five authoring files unchanged. Not an OS sandbox/security audit. |
| Performance | 7 | 3 | 5.25 | Bounded headless phases, Luau heap/GC/profiler; four full-GC samples, first warmup sample excluded from the retention trend only, unavailable resources null. VM/profile report still covers all 40 ticks. No load benchmark or GPU/native/Rust leak tracing. |
| Reproducibility | 7 | 3 | 5.25 | Four accepted commands replay identically; exact executable mismatch rejected, original valid capture rerun. No cross-platform/checkpoint/migration verification. |

Full static type verification did **not** pass in the fresh agent's isolated environment: `LUAU_ANALYZER_NOT_FOUND`. Assets and the two generated tests did pass. This limitation is retained, not converted into a successful `verify` claim. The operation score covers the declared headless input/edit/observe/replay loop, not a complete export/release pipeline. Evaluator coverage of 100% means all ten scoped questions have public execution support, **not 100% of Core features or source-code coverage**.

## Actual first-use trial

A fresh subagent received only public entry points, a representative headless task and side-effect restrictions. It did not see this rubric, suspected issues, scores or engine implementation. Its report was finalized and hash-sealed **before** the later replay probe and semantic-review role.

- **31 operations**: 8 one-shot CLI commands, 1 session launch, 22 session requests.
- First authoring success: operation **3**, `project init`, five files created.
- **One natural ordering mistake**: querying project capabilities before a project existed. The injected typo `framse` and stale revisions were deliberate negative cases, not natural guesses.
- **No product-source fallback.** It read the generated Luau starter as project-owned example content.
- Correct field repair led to x=0.5 at frame30; stale retry did not advance it again.
- Watch's `next_cursor` drained the two pages without skipping an event. Dry-run left state unchanged; commit updated it.
- Four accepted commands replayed with `identical=true`; the original session was unchanged. Close/reopen restored the authored initial state and rejected the old session ID.
- The original interactive harness was stopped only after closing its owned runtime. Its nonzero process exit reflects that recorded cleanup, **not** a successful recorder run. Later automated probes use normal EOF and separate captures.

Original report: [blind/first-use-report.md](blind/first-use-report.md). Complete request/response chronology: [blind/first-use-session-pairs.json](blind/first-use-session-pairs.json), [blind/events.jsonl](blind/events.jsonl). The [seal](blind/first-use-seal.json) locks 36 first-use files; it is not a signed attestation.

## Concrete follow-up register

| ID | Priority | Reproduction / observed cause | Direction and acceptance |
|---|---|---|---|
| CORE-SCOUT-001 | P1 | `api search "move entity"` returns 19 full descriptors, **24,132 UTF-8 bytes**, including `instances3d.remove` first. The public search covers Engine APIs, not all development tools; its matching implementation was not inspected, so lexical substring matching is only a hypothesis. | Add a compact purpose → candidate → selected-contract discovery surface reusing authoritative descriptors. Preserve existing API contracts. Compare actual response bytes and fresh-agent navigation; don't invent token savings. |
| CORE-SCOUT-002 | P1 | `api search "記憶體 GC 效能瓶頸"` returns no matches, though published `replay scenario` actually emits memory, GC and profile data. The response honestly limits its search to public Engine API, but suggests API index/systems rather than the diagnostics workflow. | Route tool intent to CLI/developer capabilities without pretending the Luau API owns host diagnostics. Test this exact query against the real existing memory example. **Do not build a duplicate leak tool.** |
| CORE-SCOUT-003 | P2 | Fresh agent followed capabilities-first docs in an empty directory: `PROJECT_CONFIG_NOT_FOUND`; init then snapshot succeeds. | Make new-project vs existing-project entry order explicit. Keep diagnostic behavior for a genuinely missing project. |
| CORE-SCOUT-004 | P1 | Fresh temp `verify` reports `LUAU_ANALYZER_NOT_FOUND`; docs/error identify the separate official analyzer. This task forbade downloads/builds. Root's earlier repo-cwd check found an analyzer, but portable/clean-environment behavior was not repaired or proven. | Validate portable SDK dependency discovery and an existing-analyzer override separately. No silent success, auto-download, or weakening the types gate. |
| CORE-SCOUT-005 | P2 | Unknown-field and exact-replay-version errors can leave structured facts/actions empty, even though explanation or `fingerprintDifferences` identifies the problem and public docs permit repair. | Normalize reusable diagnostic field/path/actual/expected/action data without game policy in Rust. Re-run the original typo and mismatch cases; preserve old captures. |

These are observed friction or explicit follow-ups, not blockers for the scoped 80-point gate. Root inspected the optional npm SDK's source while orienting, but did not use it to complete these public CLI/protocol tasks; it is explicitly outside this score and has not received a fresh public assessment here.

## Version and provenance

- Checked-out HEAD: `7bc124931e6a6ed47ee28b6dc3e7bc7646d37b5d`, master.
- Actual tested executable: `target/release/game.exe`, self-reported `0.1.0`, SHA-256 `6af56a589c4a39d3f16e176cfb2fc817ef7fcbbe7836e160c516973e86cc8c8e`.
- This is an existing build. Its build provenance is **not** attested to HEAD. Both replay fingerprint and explicit byte hashing identify the tested runtime; source HEAD alone is not treated as runtime identity.
- Pre-existing dirty paths are preserved in [subject/binary.json](subject/binary.json). The current task adds only this audit directory unless a later review explicitly says otherwise.
- The recorder's 2 MiB per-file limit excludes the 27 MiB executable. The small identity descriptor is a captured input, and each probe independently checks the actual executable hash before/after. Do not replace the expected hash to legitimize an old run.
- `subject/` contains frozen public docs and every pre-existing input copied/read by the memory probe. It is a selected audit snapshot, not a runnable source checkout or the full dependency graph.

## Execution / validation records

1. [memory-discovery-probe.mjs](memory-discovery-probe.mjs) was read in full before execution. [memory-discovery.capture.json](memory-discovery.capture.json) records 11 explicit subprocess steps plus the public helper's one nested fingerprint call: exit0, no timeout, no output truncation, no subject change. The root's informed test intentionally supplements, rather than relabels, the initial blind trial.
2. The wrong executable fingerprint run returned `incompatible` with ticks/adapter/performance unavailable (`null`); null is not a measured zero. The unchanged original valid capture then returned 40 ticks, reproduced, regression passed, four explicit full-GC samples, the first warmup sample excluded from the retention trend, `leak_proven:false`, GPU/Rust/JS/retaining paths unavailable as null. The VM/profile report includes all 40 ticks and only **one profiler stack sample**: it proves the data path works, not a localized function bottleneck. This is synthetic allocation/release evidence, **not YesSir memory evidence**.
3. [session-probe.mjs](session-probe.mjs), reviewed in full, reproduces the initial flow in a new temp project; [session.capture.json](session.capture.json) passed 30 operations / 22 session requests with normal EOF and exit0, no timeout/truncation/subject change. Both probes explicitly check the actual executable before/after. Initial `verify` is intentionally not replayed or claimed passed.
4. The initial scoring proposal and its tool output remain in `audit.proposed.json` / `evaluation.proposed.json`. The final `audit.json` / `evaluation.json` retain the same ratings with the reviewer-requested measurement wording clarified. This is an **audit wording correction, not a Core optimization or before/after score improvement**. The aggregate trial is informed; only the preserved first-use subtrial is blind.
5. Audit plugin validation itself: `node plugins/org.unone.ai-native/cli.mjs test` passed its four invariant checks; `npm test` in that plugin passed **23/23**. Those are audit-tool tests, not 23 new Core tests.

## Recheck without repeating discovery

From the Unone repo root, validate the preserved final report read-only:

```powershell
node plugins/org.unone.ai-native/cli.mjs evaluate --root D:/Projects/Unone --report docs/audits/core-scout-2026-09-11/audit.json
```

For a real rerun, first read the selected probe again. The following uses the same twelve frozen inputs and reserves **new** output names; it never replaces existing captures. The two probes need the exact existing Windows executable. A changed binary requires a separate reviewed version-specific audit, not changing old hashes.

```powershell
$coreSubjects = @()
rg --files docs/audits/core-scout-2026-09-11/subject | Sort-Object | ForEach-Object {
    $coreSubjects += @('--subject', $_.Replace('\', '/'))
}
node plugins/org.unone.ai-native/scripts/record-probe.mjs --root D:/Projects/Unone --script docs/audits/core-scout-2026-09-11/session-probe.mjs --output docs/audits/core-scout-2026-09-11/retest-session-001.capture.json --mode fixture --timeout 60000 --limitation 'Reviewed same-binary isolated headless repeat; no type-check, GPU, other OS, real game or release validation.' @coreSubjects
node plugins/org.unone.ai-native/scripts/record-probe.mjs --root D:/Projects/Unone --script docs/audits/core-scout-2026-09-11/memory-discovery-probe.mjs --output docs/audits/core-scout-2026-09-11/retest-memory-001.capture.json --mode fixture --timeout 60000 --limitation 'Reviewed same-binary synthetic GC workload; not a leak verdict, workload benchmark or rendering test.' @coreSubjects
```

Review new outputs before writing a new report that cites them; do not relabel these informed repeats as another blind trial. Each run retains its own C: temp directory and raw logs. No real project needs to be selected or modified.

No `cargo test --workspace`, clean Rust build, downloaded analyzer, browser, GPU, macOS, iOS, Android, real game, MCP transport or release-package validation is claimed by this report.
