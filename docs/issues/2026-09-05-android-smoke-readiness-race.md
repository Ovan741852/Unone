# Android smoke readiness race

## Status

Resolved in package smoke tooling; pending delegated reruns against package
`10d1206`. The first failure remains part of the validation history.

## Detection

Auto Chess reported that a cold install/launch could take longer than the
smoke script's fixed two-second wait. The APK installed, the process stayed
alive, and later `dumpsys`/logcat showed the expected Activity, `project_loaded`,
`runtime_paused`, and `runtime_resumed` events, but the script failed before
those later facts were collected.

## Impact

This was generic Android host tooling and could affect every game. It was not
evidence of an engine or game runtime failure.

## Fix

Both the repository Android smoke script and package-contained smoke script now
poll the expected Activity for up to 15 seconds after cold launch and resume.
They still fail closed on timeout and preserve the original failure output.

## Required regression

Each delegated game must rerun the package smoke with an emulator/device and
record the actual package commit. A successful APK build or cross-compile alone
does not close the Android runtime gate.
