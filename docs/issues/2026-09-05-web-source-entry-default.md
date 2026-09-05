# Web source loader entry-script default mismatch

## Status

Resolved in engine source; pending fresh package and delegated-game regression.

## Detection

The Red Alert validation subagent reported that generic Web source mode returned
`script request failed: 404` when `project.unone.json` omitted `entry_script`.
Rust `ProjectConfig` already defaults that field to `scripts/main.luau`, but the
Web runner passed the missing value directly to `new URL()`.

## Impact

This was a cross-platform host-contract issue. Any game using the documented
default project scaffold could fail only in Web source mode while native and
packaged-bundle modes passed.

## Fix

`web/runner/main.js` now applies the same `scripts/main.luau` default as the
Rust project loader. The delegated task was told to retain its blocker record,
pause only the dependent source-mode gate, and continue independent work.

## Required regression

After the next immutable engine package is created, rerun both generic Web
source and packaged-bundle smoke against a project whose config omits
`entry_script`, and attach the semantic result to the delegated validation
report.
