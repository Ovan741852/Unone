# Capability-first delivery and English-only engine

Date: 2026-09-06. Status: implementation started; plan review pending.

## Authorized outcome

Finish the API project-context correction, complete ordinary 2D sprite rotation,
scale and painter order across existing hosts, then deliver minimal audio.
Keep the previously approved hot-update failure-consistency repair bounded.
Engine-authored public documentation, tutorials, diagnostics and host UI use
English. Game content and Unicode/path regression fixtures remain unrestricted.
Original evidence and historical logs are evidence, not current specifications;
do not rewrite their raw output to make past releases appear English-only.

## Delivery boundaries

1. Close the existing API regression with executable empty-query and relative-root
   tests, independent review and package evidence. No new discovery command.
2. Finish the existing 2D transform/layer contract in the native preview, WebGPU,
   Web DOM sprite layer and Android Canvas host. Fix the documented DOM center
   offset as part of the same centered-transform contract; never compensate in
   game coordinates. Preserve independent colliders and UTF-8 ID tie-breaking.
   Procedural native/Android visuals are not evidence of texture support.
3. Audio needs a bounded lifecycle contract before implementation: deterministic
   playback intent belongs to core; decoding, device timing and playback belong
   to host. Define play/stop, volume, loop, handles, disabled-system behavior,
   reload behavior and autoplay denial. Do not create a mixer editor or force
   games to implement host audio. Do not claim device playback from snapshots.
4. Reproduce hot-update failure paths, then repair the actual consistency boundary.
   Do not expand this into general transactions or a new update framework.
5. Translate current engine guidance in place. Preserve API identifiers and
   machine codes; do not translate user data, filenames or diagnostic facts.
   Audit actual UTF-8 output as well as source text. No localization framework.

## Verification and documentation policy

Game authors use the existing aggregated `verify` entry point. Strict asset
inspection is already included; do not prescribe it as an additional duplicate
gate. Host/package parity is the engine distributor's responsibility. Actual
visual/audio checks remain necessary for the capabilities a game uses.

Add a check only for a concrete failure mode, preferably inside an existing
entry point. Preserve defenses against data loss, corrupt content and inconsistent
runtime state, including defects in existing capabilities.

Write ADRs for shared boundaries or material alternatives, not routine patches.
Put field definitions in schemas/API docs and repair history in issues/devlogs
with regression evidence. Preserve the camera projection/input rationale and
independent-collider decision. Replace superseded current instructions in place;
Git history and explicitly historical evidence retain why they changed.

## Review and acceptance

Luna/max implements bounded non-overlapping work. Review the plan independently;
resolve concrete objections before the corresponding implementation. Independently
review the implementation and run a package-only game exercise with only the
engine package, a game plan and an empty game directory. Report blockers promptly.
Record untested hosts as untested. All seven final-game gates remain unpassed.

Do not delete caches, packages, game files or evidence as part of this work.
Develop on master and make scoped local commits after verification.
