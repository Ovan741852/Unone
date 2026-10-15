# Code review and decision records

## Purpose and cadence

Use Claude CLI as an independent, read-only review layer at meaningful vertical
slices, every 3-5 commits, and after changes to runtime ownership, lifecycle,
platform adapters, protocol or data formats. Repeated game-agent failures also
warrant review. Review is not authorization for the reviewer to edit files.

## Review scope

Review correctness, Rust/FFI safety, deterministic simulation, reload behavior,
semantic diagnostics and engine/host/game boundaries. Require concrete findings
with file/line, failure scenario and proposed correction. Distinguish a verified
defect from a hypothesis or missing test. Do not rewrite working architecture
solely because a reviewer speculates that an existing invariant might be absent.

Run non-interactively with read-only access or a supplied fixed diff. Record the
exact revision range, CLI version, command, exit status and raw response. If the
review cannot run, preserve the actual failure; do not label it completed.

Suggested prompt:

```text
Review this fixed Unone Rust/Luau diff and relevant code as an independent
game-engine reviewer. Do not edit files. Report concrete correctness, safety,
determinism, hot-reload or boundary defects with file/line and reproduction.
Separate confirmed findings from hypotheses and bounded test gaps.
```

Independent package-only game validation is different: the agent receives only
an immutable engine package, game plan and empty game directory, not source or
previous review conclusions. Source review is not proof of host output.

## Documentation discipline

- ADR: a shared semantic/ownership boundary or a material decision between
  alternatives. Preserve the rationale, including why rejected options failed.
- Schema/API docs: field definitions and callable contracts.
- Issue/devlog plus regression: ordinary fixes, reproduction, impact, root cause,
  review disposition and evidence.
- Replace obsolete current instructions in place. Keep historical raw evidence
  and Git history; neither is authorization to delete current files.
- Use English for engine-authored guidance and diagnostics. Preserve user data,
  Unicode regression inputs and original external-review/test output.

Keep the author's existing aggregate verify workflow. Distributor parity and
source code review must not become duplicate mandatory author commands.
Retain checks for demonstrated silent failure, data loss or inconsistent state.

## Recorded reviews

- 2026-10-15: official-player defaults, declarative-effect discovery, explicit
  renderer replacement and engine-owned sprite shaders. Independent agent and
  actual GPU/player validation completed; both Claude CLI attempts failed to
  complete and their raw results are preserved:
  [record](reviews/2026-10-15-official-player-shader-boundary.md).
- 2026-09-05: Claude 2.1.206 reported an expired OAuth session. Attempts 17-27
  were stopped after roughly 60-70 seconds without output, so were not completed
  reviews. Version 2.1.260 completed review 28:
  [findings](issues/2026-09-05-claude-cli-review-findings-28.md).
- Review 29 initially hit a session limit; the user approved committing first.
  The fixed range 5ae821e..6ab9b60 was subsequently reviewed with 2.1.260, exit 0,
  no actionable P1/P2. No build/test execution by Claude:
  [record](issues/2026-09-06-claude-cli-review-29.md).
- Review 30 covered 04af786..4a128d7. Findings and the main agent's independent
  counterexample are in [record](issues/2026-09-06-claude-cli-review-30.md).
- Review 31 covered 4a128d7..c187df8, exit 0, no new actionable P1/P2:
  [record](issues/2026-09-06-claude-cli-review-31.md).
- The API project-context review raised two conditional concerns: global CLI
  flags and canonical roots. Existing code already provides both invariants.
  Additional tests now execute the emitted empty query and a relative-project
  action from an unrelated directory; all eight API contract tests passed in
  the main agent's run. [Raw Claude output](evidence/2026-09-06-ai-authoring/api-context-claude-review.txt).
  This does not establish new-package or final-game acceptance.
- 2026-09-21: architecture and code-health design review at `39d8ee1`, requested
  as a design judgement rather than a defect hunt. Static reading only; no build,
  test or clippy run, because the review environment had no reachable crate
  registry. Seven architecture findings, nine maintainability findings, and four
  open decisions for the author. Only documentation and engine-authored message
  text were changed:
  [record](issues/2026-09-21-design-review-architecture-and-health.md).
