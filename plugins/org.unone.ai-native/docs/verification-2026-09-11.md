# Initial verification — 2026-09-11

Version 0.1.0; rubric 1.0.0. Windows x64 / Node 24.14.1.
Unone base HEAD `7bc124931e6a6ed47ee28b6dc3e7bc7646d37b5d`, existing `master`, uncommitted plugin/docs additions.
No runtime Core source, gameplay, other plugins, accounts, remote settings or deployment changed.

## Executed

- `npm test`: 22 passing test cases, including real Node stdio, CLI and recorder subprocesses.
  Synthetic perfect-score fixtures test validator behavior only; they are not product audit claims.
- UTF-8 skill validator: `python -X utf8 <skill-creator>/scripts/quick_validate.py skills/unone-ai-native-audit` passed.
  Windows default cp950 failed decoding initially; using explicit UTF-8 fixed the validator invocation, not the skill content.
- Real existing `target/debug/game.exe` plugin inspect/test/recommend/describe/call passed.
- `scripts/verify-host.mjs --host <game.exe> --project <Koncrate-Editor> --report docs/audits/ai-native-2026-09-11/planning/audit.json`
  returned `UNONE_AI_NATIVE_HOST_SMOKE_OK`, verified stale contract rejection and repair, and returned planning 46.5/100.
- Measured one recommendation payload at 1,406 UTF-8 bytes vs 12,462 bytes for all five operation contracts
  after adding the complete report schema. This is one payload sample, not a model-token or total-session benchmark;
  selecting an operation adds a request/response and can outweigh savings for a tiny catalog.
- Three independent target evaluators used recommend/describe, snapshot, recorder and evaluate successfully.
  The common missing `access` enum was corrected in public docs/catalog; evaluate description now includes reportSchema/preparation.
- An independent read-only code reviewer reproduced three defects: mutable recommendation metadata,
  lost capture after a subject was deleted, and a catalog caller mutating shared rubric weights.
  All were fixed with regression tests; public metadata is copied and internal criterion objects frozen.
  The independent reviewer reran all three original reproductions and confirmed the fixes;
  final review reported no unresolved blocking bug. The catalog mutation retest remained
  35 synthetic points / 100% coverage / total weight 100 before and after attempted mutation.

## Actual target audits

Reports and captures live in Koncrate-Editor's `docs/audits/ai-native-2026-09-11`.
They are local, source-assisted fixture evaluations, not genuine accounts, models, GUI or cross-device tests.

| Target | Evidence-backed index | Assessed coverage | Execution coverage | Public execution coverage |
| --- | ---: | ---: | ---: | ---: |
| Planning | 46.5/100 | 93% | 73% | 0% |
| Dispatch | 48/100 | 93% | 73% | 0% |
| Viewer | 49/100 | 93% | 63% | 0% |

All gates need work. Score differences across these different scenarios are not a product ranking.
Unknown performance/cost remains null; hashes establish consistency, not authors' honesty or semantic truth.

## Remaining boundaries

- This plugin implements two-stage discovery for its own operations and supplies a reusable helper.
  Global cross-plugin recommendation and migration of existing plugins are not implemented.
- It is a read-only developer plugin; probe execution is a separate explicit local CLI, not an MCP operation.
  The recorder is not a sandbox. Non-Windows process-tree timeout behavior and Mac execution were not verified.
- Path checks reject static traversal and escaping symlinks; they are not proof against a hostile
  filesystem changing links concurrently. Use host/OS isolation for untrusted plugins or checkouts.
- Top-level telemetry is available in standalone CLI/stdio; the current Unone host preserves
  value/diagnostics/effects but drops extra top-level fields. Do not claim this telemetry reaches every host.
- No semantic model or external recommendation API is called. Keyword matches can miss synonyms; empty results are explicit.
- No installer, global skill installation, remote publication or CI release gate was added. Evaluation gates apply when invoked.
