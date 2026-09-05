# Android smoke readiness race

## Status

Resolved in package smoke tooling; pending delegated reruns against the latest
immutable package. The first failures remain part of the validation history.

## Detection

Auto Chess reported that a cold install/launch could take longer than the
smoke script's fixed two-second wait. The APK installed, the process stayed
alive, and later `dumpsys`/logcat showed the expected Activity, `project_loaded`,
`runtime_paused`, and `runtime_resumed` events, but the script failed before
those later facts were collected.

## Impact

This was generic Android host tooling and could affect every game. It was not
evidence of an engine or game runtime failure. A follow-up RTS run showed that
the Activity foreground poll could pass before the asynchronous
`project_loaded` event was emitted, so the original one-shot log check had the
same race in a second location.

## Fix

Both the repository Android smoke script and package-contained smoke script now
poll the expected Activity and the `project_loaded` lifecycle event for up to
15 seconds after cold launch and resume. They still fail closed on timeout and
preserve the original failure output.

## Required regression

Each delegated game must rerun the package smoke with an emulator/device and
record the actual package commit. A successful APK build or cross-compile alone
does not close the Android runtime gate.
