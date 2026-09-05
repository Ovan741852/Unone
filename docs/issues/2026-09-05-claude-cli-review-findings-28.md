# Claude CLI review #28

## Scope

- Review commit: `634c07c2490764bc58c27ee2826bdad1757aa562`
- Claude CLI: `2.1.260`
- Mode: non-interactive, plan/read-only, no repository edits
- The review was started before the Android polling patch in `9981e26`.

## Findings and disposition

1. **High — atomic writes and Windows durability.** `bundle.rs` only called
   `sync_all` on non-Windows and removed the destination before rename. Fixed
   by syncing on every platform and using Windows `ReplaceFileW` /
   `MoveFileExW` with write-through semantics; Unix keeps rename replacement.
2. **Medium — portable source traversal.** Bundle source validation did not
   reject Windows-rooted strings when inspected on another host and did not
   reject symlink escape. Fixed with portable lexical checks and canonical
   project-root containment.
3. **Medium — Android readiness race.** The review correctly identified the
   one-shot `project_loaded` log read. Fixed in `9981e26` by bounded polling;
   RTS rerun passed on the new package. The original 634c07c failure remains
   in delegated validation history.
4. **Medium — package verification.** Added a package-contained hash/size
   verifier and made generated package files read-only after verification.
5. **Medium — test assertion exclusivity.** Runtime now rejects ambiguous
   targets and multiple/missing numeric comparators with
   `TEST_ASSERTION_INVALID`; the JSON schema now describes the same rule.
6. **Low — Web action reconciliation.** Kept under observation because the
   current behavior is functionally correct and the change would be cleanup,
   not an acceptance or safety fix.

The review also confirmed the normalized UI contract, pointer edge queue,
DOM action dispatch, mobile FFI boundary, project/scene schema alignment and
engine/game ownership split.
