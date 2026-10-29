# Semantic review of the spatial SDK retest

Reviewed 2026-10-23 against `audit.proposed.json` and
`evaluation.proposed.json`, after the fresh author's artifacts were sealed and
the three final recorder probes completed. This reviewer read the repository
instructions, Scout report contract and rubric, the evaluator's gate rule,
selected implementation paths, source review and validation ledger, public and
Web probes, and the sealed SDK authoring example, command records and independent
geometry verifier. This review wrote only this file. It did not change product
code, proposals, historical audits, games or sealed evidence, and did not run a
new engine, analyzer, browser or GPU trial.

## Decision and actual gate

The proposed answers and ratings are supported within the declared SDK-only
public CPU authoring scope, with the separately labelled informed native and
fresh WASM CPU/WebGPU regressions. No new blocking product finding was confirmed
in this review. The four previous P2 correction claims have positive evidence;
the empty-table observation limitation remains explicit.

The actual Scout result is **76.25/100, `gate=needs_work`**, with
`blockers=[]` and `unverifiedCritical=[]`. All ten questions were assessed:
coverage, execution coverage and public execution coverage are each 100%, and
the reported possible range is `[76.25,76.25]`. Coverage measures the referenced
scoped evidence; it is not complete engine, host or device coverage.

All four critical dimensions meet their minimum rating, but
`plugins/org.unone.ai-native/src/audit.mjs` also requires earned points of at
least 80 for `supported_within_scope`. The score is below that threshold. Any
handoff must preserve `needs_work`; successful fresh authoring and closure of
the four named P2 causes do not change that aggregate result. Raising ratings
merely to cross 80 would be unsupported. No change to the reviewed proposal is
required.

| Criterion | Accepted rating | Semantic basis |
|---|---:|---|
| purpose | 3 | SDK entrypoints and guide led the new author to the representative task and clear engine/caller ownership. |
| capabilities | 3 | The actual SDK ships the guide and canonical types; public spatial discovery succeeds, including the informed collision/Chinese queries. |
| operation | 4 | The original authored Luau passes official strict checking and independently completes masked nearest, ordered overlap and moving-target sweep, including deliberate negative inputs and repaired continuation. |
| context | 3 | Frozen caller data, versions and ticket usage are observed through failed replacement, packed repair and index destruction. |
| observation | 3 | Complete typed records and wide numeric values publish successfully; empty hit tables still lose JSON array identity. |
| diagnostics | 3 | Duplicate IDs, negative radius and ticket timing/consumption errors are actionable; structured field/actual/expected diagnostics remain limited. |
| recovery | 3 | Rejected replacement and early take preserve usable state, and the repaired/new-tick path succeeds; device interruption is outside this fresh task. |
| boundaries | 3 | Queries leave the unrelated full scene entity unchanged; this establishes the local geometry/scene boundary, not OS or account isolation. |
| performance | 2 | CLI CPU phase/resource telemetry is real, but these correctness fixtures do not isolate spatial or transfer cost and establish no speedup threshold. |
| reproducibility | 3 | Inputs, tools, probes and evidence are fingerprinted; failed attempts and fresh authorship remain distinct from later replay. |

## Evidence and consistency

The reviewed proposal SHA-256 is
`879f7fd8f43880a7b28cd5e91861ae5d95b0a20e009eff7a7c3658fdcc46feb1`.
The reviewed evaluator output SHA-256 is
`2d10af2c3670ef0aac55ccb87b4c7c1b5e6fc5e98ae6e12d9a3dfd1b88d4b241`.
All 33 proposal subject hashes and all 11 evidence hashes/excerpts match their
current bytes. The evaluator accepted every claimed rating without a cap; the
weighted sum independently recomputes to 76.25.

`capture-public-final.json`, `capture-web-final.json` and
`capture-blind-replay.json` contain identical ordered selections of 33 subjects,
including the three sealed headless author inputs. Every subject and selected
probe hash matches current bytes. All three have exit code 0,
`sourceChanged=false`, `timedOut=false`, `outputTruncated=false`, and null
spawn/source-check errors. Their raw outputs support the probe assertions, not
just a hand-written success summary. The public case asserts nonempty equal
same-project/same-seed digests. The blind replay preserves expected ID groups
`[[41],[17,41,4294967295],[73],[0]]` and a sweep fraction
`0.7857142686843872`, agreeing with the independent `11/14` calculation within
the authored tolerance.

The blind detached manifest hash is
`f3edbfa874ed4bed91c36f28335432b370c601bbe36de7b18a0acb81199225f1`.
It matches `SEAL.txt`. All 156 included artifacts match their recorded SHA-256
and length, with no missing or unlisted files beyond the two explicit seal
exclusions. The five first-authored and final project files differ only by the
three-byte UTF-8 BOM removed from `project.unone.json`; gameplay bytes did not
change. The canonical type text matches the packaged canonical types after
newline normalization and remains embedded unchanged in the final script.

The trial correctly uses aggregate mode `retest`. Its 38 positive operation IDs
exclude bootstrap 000 and include final sealing; first strict success is 026,
first successful submission is 027, and first delivered geometry is 028. The
initial BOM check failed before analyzer invocation. The first actual official
analyzer invocation passed, and neither pre-delivery native run failed. Two
natural guesses are distinguished from deliberate invalid inputs and later
verifier/tooling failures. The bootstrap recording limitation is disclosed.
Hashes validate local consistency, not independent authorship certification or
a clean, reproducible source-to-binary build.

## Four named P2 corrections

1. **Complete info publication:** public native and fresh WASM captures preserve
   the complete info record, including numeric
   `limits.safe_integer=9007199254740991`; their result records also preserve
   max-u32 IDs. The observation-only number conversion is consistent with the
   reviewed source correction.
2. **Direct canonical result publication:** official strict checking and actual
   native runs accept unadapted batch/query/hit publication. The fresh author's
   original Luau also publishes complete batches and individual query results
   without casts, stubs or a source fallback. The targeted type-negative suite
   is a separately labelled reported regression in `validation.json`, rather
   than a new test executed by this semantic reviewer.
3. **Tiny contact normal:** the informed public fixture and fresh Web CPU/WebGPU
   main/Worker runs exercise the valid `3e-23` input and verify the expected
   unit direction. This supports the normal correction, while existing f32
   tiny-distance, boundary-membership and cross-device tolerance limitations
   remain. It does not establish exact CPU/GPU distances or determinism.
4. **Packed SDK guide:** the actual SDK contains the complete guide with the
   canonical source hash, its README links it, and the fresh author reads it
   through the SDK before completing the task. Pack/build regression results
   remain labelled implementation-verification records.

The failed informed `capture-public.json` and `capture-public-v2.json` remain
historical evidence of, respectively, the pcall contextual-type/local-shadow
fixture error and the JavaScript assertion that treated keyed entities as an
array. Their corrected fixture appears in new probe versions; the failures
were not rewritten or claimed to pass. The final captures were actually rerun
with the expanded subject set.

## Retained limits and reporting calibration

All four replacement queries have zero hits in Luau, while their direct generic
observation JSON contains `hits:{}`. The replay explicitly reports all four
shapes and the original Luau confirms `#hits==0`. The existing generic
observation codec infers arrays from present contiguous numeric keys; an empty
table has no such keys and becomes an object. The public generic contract
allows both object and array values but supplies no discovered empty-array
discriminator or promise that an empty typed Luau array retains JSON identity.
This is a material limitation for external JSON consumers expecting `[]`, and
supports observation rating 3 rather than 4. It is a retained follow-up, not
evidence that the numeric/type publication corrections failed. The proposal's
observation answer, next action and trial limitations make it visible despite
an empty `issues` list.

The Web full-info snapshot is published during `start`, before external backend
setup, and names `cpu` even in the later GPU runs. The update publication and
host reports separately show `webgpu`; the proposal correctly avoids claiming
the start snapshot already identified the selected GPU executor. Main/Worker
execution evidence supports real compute regression coverage, not rendered
presentation or a performance benchmark.

The prior malformed direct-JavaScript sparse-vector validator finding remains
explicitly outside this canonical Luau task and is not claimed fixed. Device
loss, reload interruption, persistent spatial saves, rendering and cross-device
certification are also not established. The new SDK/release scope differs from
the earlier repository/debug audit, so a numerical before/after score claim
would be misleading. The accepted conclusion is successful bounded fresh
authoring and evidence for the four corrections, alongside the unchanged
`needs_work` aggregate gate and stated follow-ups.
