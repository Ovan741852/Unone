# Blind public spatial interface scout

The requested generic geometry example works on the existing CPU backend. The first delivered computation is operation 17, at the second update after submitting in the first update. The final example passes the official strict Luau typecheck (operation 23), and its three-tick run publishes verified frozen and repaired results (operation 24). Eleven independent assertions check saved engine outputs; their results are in report.json.

This was a fresh public-interface evaluation. Entry points were README.md and target/debug/game.exe --help. I read repository instructions, linked public docs, public JSON schemas, API search/describe output, and officially generated Luau typings. I did not read crates/**, engine implementation JavaScript, existing tests/probes, previous audits, or any other evaluator's findings. sourceFallbackStep = null. No installs, builds, network/account/model calls, commits, or existing game/product files were changed. All authored artifacts are new files under this blind directory; failed variants are preserved.

## Actual computation and delivery

Four generic spheres use category bits 1, 2, 4, 1. The closer category-2 sphere at x=0.5 is excluded by nearest mask=1. The category-1 sphere id10 at x=2 wins with center distance 2, surface point [1.5,0,0], normal [-1,0,0]. Overlap centered at [2,0,0], radius 0.5, mask=1 returns [10,40] in ID order; the coincident id10 hit uses +Z as documented.

The continuous query sphere moves from [0,0,0] to [10,0,0], radius 0.5, mask=4. The target id30 moves from previous_position [5,2,0] to position [5,-2,0], radius 0.5. Relative center displacement is (10t-5,4t-2,0); combined radius is 1. Earliest contact is t=0.5-1/sqrt(116)=0.40715233091147407. Actual f32 fraction is 0.40715232491493225, distance 4.071523189544678. Contact point and normal also agree within 1e-6. Treating the target as stationary at its current endpoint would miss this contact, so this exercises actual moving-target geometry.

Tick 1 deliberately attempts radius=-1. It is rejected with bodies[0].radius must be finite and in 0..=1000000. The old batch still submits as version 1. A same-tick take returns SPATIAL_RESULT_NEXT_TICK; catching that error preserves the ticket. A valid replacement moves id10 to x=9 and returns version 2. Tick 2 successfully takes the frozen version-1 result. Reusing that consumed ticket returns SPATIAL_TICKET_UNKNOWN. A new query sees version 2 at tick 3: nearest becomes id40 at distance 2.5, overlap becomes [40]. Actual world state shows id10 at [9,0,0], live version 2, and no outstanding tickets. The invalid update did not advance the version.

The one-tick output (operation 16) has no published geometric result. It shows a frozen version-1 ticket beside the repaired live version 2. Operation 17 is the first successful delivered geometric result. Operation 12's prospective label says first successful computation, but that run actually failed in start; its retained stdout is authoritative and it is not counted as success.

## Discoverability and natural failures

README links directly to the spatial batches guide. API search spatial returns all relevant methods, exact parameter shapes, lifecycle information, and usage examples. The guide clearly states array vectors, category/mask bitwise semantics, nearest center distance, surface point/normal semantics, moving target previous_position, frozen versions, update-only submission, N+1 delivery, one-shot tickets, and bounds. I did not have to guess a spatial method name or geometry field. Canonical generated typings were directly usable and the installed analyzer was discovered automatically.

Two natural cross-API assumptions failed before the first result. These are separate from the three deliberate negative cases:

1. Directly publishing api.spatial.take's SpatialBatchResult through observation.set fails official typechecking: expected ObservationValue, got SpatialBatchResult (operation 8). All fields are otherwise serializable. I preserved the first example and authored an explicit typed serialization adapter in a new variant, which passed (operation 10). This adds manual plumbing to the obvious AI observation path; a canonical conversion/example or compatible types would help.
2. Directly publishing api.spatial.info passes official typechecking because info returns {[string]: ObservationValue}, but fails at runtime with observation integer is outside the portable Luau integer range (operations 11-13). Public-only isolation reproduces the error specifically for limits.safe_integer, whose exposed string value is 9007199254740991 (operation 21); all other individual limit fields publish. I do not infer the internal numeric cause without source. A value officially described as ObservationValue should be publishable, or the contract should make this exclusion explicit. The final example publishes known scalar info fields.

Error messages made the repairs possible. The invalid body diagnostic uses zero-based bodies[0] although the caller supplied a Luau 1-based array; this is a minor location convention friction. API descriptors repeat broad side-effect text even for info/pack and list common errors without exact codes, so the focused guide is more useful than describe alone for detailed lifecycle recovery.

I assumed standard Luau pcall recovery for rejected validation/timing calls; successful later results confirm that assumption. I did not assume GPU performance or polling semantics: the public fixed-tick contract explicitly says no isReady branch and CPU uses the same delivery boundary.

The intermediate portable-example uses tostring on all info fields, including nested tables. That preserves enough scalar evidence to proceed but emits process-specific table addresses, so its observation digests must not be used as deterministic evidence. The final-example replaces this temporary adapter with scalar-only info publication.

## Evidence and reproducibility

- final-example/main.luau and project.unone.json: final generic example with canonical types and adapters.
- example/: preserved natural direct-result type failure.
- typed-example/: preserved natural info-publication runtime failure after fixing result typing.
- portable-example/: first delivered geometry with temporary string info workaround.
- info-probe/: small public API reproduction isolating safe_integer.
- operations.ndjson: chronological commands/argv, stdin, timestamps, exit status, stdout and stderr from operation 3 onward. Outputs are retained in full, including failures.
- command-transcript.md: readable exact argv and raw outputs from the ledger.
- engine-api.luau: generated official type contract.
- report.json: observations, conclusions, actual state and eleven assertion results.
- bootstrap-entrypoints-recapture.txt: durable recapture of initial public instructions/README/help.

Operation 1 was the initial PowerShell read of D:/AGENTS.md, D:/Projects/AGENTS.md and D:/Projects/Unone/AGENTS.md if present, followed by README.md and game.exe --help. Only Unone/AGENTS.md existed. The directory inventory branch emitted no output because blind did not yet exist. Exit was 0, stderr empty, and complete stdout was visible in the tool response. Operation 2 created the new blind directory and run-command.mjs recorder; exit was 0 with empty stdout/stderr. Their exact initial commands are recorded in bootstrap-operations.json. The recorder did not yet exist for operations 1-2, so I did not pretend a later recapture was the original timestamped stdout. Operation 25 was a separate shell-quoting error while recapturing this evidence; it is preserved and repaired by owned Node helper in operation 26. It happened after geometry success and is not an engine/API failure.

No GPU, rendering, performance, capacity stress, cancellation, or hot reload claim is made. The requested early/consumed/retry boundary and validation repair were exercised through actual results. No source fallback was needed.

## Chronological command ledger

| Operation | Purpose | Exit |
|---|---|---|
| 3 | Public spatial guide and CLI query discovery | 0 |
| 4 | Public session and authoring contracts | 0 |
| 5 | Official schema and canonical typing generation | 0 |
| 6 | Inspect generated spatial types and focused Lua entry contract | 0 |
| 7 | Create new isolated generic geometry example and predeclare expected results | 0 |
| 8 | Official type check of isolated example | 1 |
| 9 | Preserve natural type failure and create explicit observation adapter variant | 0 |
| 10 | Type check repaired publication variant | 0 |
| 11 | One tick: invalid data, early delivery and valid repair | 1 |
| 12 | Two ticks: first successful geometry computation and consumed-ticket rejection | 1 |
| 13 | Three ticks: actual repaired version and state | 1 |
| 14 | Preserve info publication failure and create portable string info variant | 0 |
| 15 | Type check portable variant | 0 |
| 16 | One tick portable variant: pending only and invalid repair boundaries | 0 |
| 17 | First delivered geometric results on the second tick | 0 |
| 18 | Third tick delivers repaired v2 and drains tickets | 0 |
| 19 | Create public-only info serialization isolation | 0 |
| 20 | Typecheck public info isolation | 0 |
| 21 | Inspect actual info leaf values and isolate portability failure | 0 |
| 22 | Create final generic example using scalar info and typed result adapter | 0 |
| 23 | Final example official typecheck | 0 |
| 24 | Final example actual three tick results and state | 0 |
| 25 | Recapture bootstrap public entrypoints and executable identity for durable evidence | 1 |
| 26 | Repair shell quoting in bootstrap evidence capture using owned Node helper | 0 |

After this report is generated, the verifier invocation is appended as the next ledger operation. seal.mjs then writes SHA256SUMS.json and SEAL.txt once. The manifest covers every other artifact in this blind directory, including this report, source files, and the final ledger. No covered artifact is rewritten after sealing.
