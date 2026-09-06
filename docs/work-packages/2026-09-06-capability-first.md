# Capability-first delivery and English-only engine

Date: 2026-09-06. Status: Web-only plan independently reviewed; implementation
started. Audio and reload lifecycle proposals require separate bounded review.

## Authorized outcome

Finish the API project-context correction, complete ordinary 2D sprite rotation,
scale and painter order on Web, then deliver minimal Web audio. The user's
subsequent priority instruction is Web first, Android later. Native/Android
implementation, rebuilding and device parity are deferred, not exit conditions
for this Web slice.
Keep the previously approved hot-update failure-consistency repair bounded.
Engine-authored public documentation, tutorials, diagnostics and host UI use
English. Game content and Unicode/path regression fixtures remain unrestricted.
Original evidence and historical logs are evidence, not current specifications;
do not rewrite their raw output to make past releases appear English-only.

## Delivery boundaries

1. Close the existing API regression with executable empty-query and relative-root
   tests, independent review and package evidence. No new discovery command.
2. Finish the existing 2D transform/layer contract in WebGPU and the
   Web DOM sprite layer. Fix the documented DOM center
   offset as part of the same centered-transform contract; never compensate in
   game coordinates. Preserve independent colliders and UTF-8 ID tie-breaking.
   Native/Android rendering is deferred; do not claim parity or texture support.
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

Independent review approved Web dispatch with the following concrete constraints:

- All visible ordinary sprites in the runner use one DOM painter layer, including
  procedural fallbacks for absent/unresolved assets. Sort images and fallbacks
  together by signed layer and UTF-8 ID bytes. Suppress duplicated runner 2D
  quads but preserve standalone WebGPU sprite rendering and the 3D path.
- Align canvas content and DOM overlay geometry. Apply centered rotation with
  the y-down sign conversion and scale exactly once; WebGPU transforms corners
  in world space before projection through the same camera contract.
- Expose rotation/scale/layer in semantic summary with deterministic ordering.
- Exercise nondefault camera/zoom, non-square viewports, missing assets, mixed
  image/fallback order and numeric-looking/Unicode IDs. These are host regressions,
  not additional author commands.

Luna/max implements bounded non-overlapping work. Review the plan independently;
resolve concrete objections before the corresponding implementation. Independently
review the implementation and run a package-only game exercise with only the
engine package, a game plan and an empty game directory. Report blockers promptly.
Record untested hosts as untested. All seven final-game gates remain unpassed.

Do not delete caches, packages, game files or evidence as part of this work.
Develop on master and make scoped local commits after verification.
