# Public Core first-use exploration

No score. Started 2026-09-11, local Windows host. Parent provided the already-built binary path D:/Projects/Unone/target/release/game.exe and required a synthetic project in fresh C: OS temp storage. No engine implementation, prior audit, rubric or scores were consulted. No repository product files are modified.

## Pre-CLI order

1. Read supplied/root AGENTS.md and README.md. The README directly revealed project init, public API discovery, platform snapshot and developer-session docs.
2. Read README-linked docs/ai-workflow.md, docs/developer-session.md, docs/profiling.md, docs/runtime-contracts.md. First batched tool output was truncated, so developer-session.md was read again in full. These are public contracts, not implementation. Developer-session.md incidentally contains its own historical verification section; no linked evidence, audit, scripts or source was opened.
3. Created this new OS-temp root and an empty child game directory. Found preinstalled Node and Python, but only Node is used for subprocess transport and generated raw logs.
4. Authored capture.mjs and plans.json with apply_patch. The harness invokes argument arrays, preserves stdout/stderr and exact stdio chunks in raw/ and events.jsonl, hashes the provided binary, uses only its own child processes, and has bounded timeouts.

Raw CLI/protocol chronology starts in events.jsonl. The exploratory commands will be added to plans.json only as public output/docs justify them. Generated starter files will be inspected as authored game-side fixtures, not as engine implementation.
