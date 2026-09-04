# Issue: validation matrix resolved project paths from the wrong root

## Symptom

`validate-game-matrix.ps1` reported missing evidence for existing Angry Birds 2D and AVG files.

## Classification

Tooling/path logic issue, not an engine architecture issue. The acceptance matrix intentionally lives in `D:/Projects/Unone_Games/validation/`, while each `project_path` is relative to the games workspace root.

## Fix

Resolve `project_path` from the parent of the matrix directory (`D:/Projects/Unone_Games/`) and document that contract in the validation README. Keep the validator fail-closed: existing evidence changes `evidence_complete`, but a game remains not passed until its declared status is `passed`.

## Regression

Re-run the validator after the fix. Angry Birds 2D and AVG must report `evidence_complete=true`; the six unimplemented final gates must still produce `VALIDATION_GATE_NOT_PASSED` diagnostics.
