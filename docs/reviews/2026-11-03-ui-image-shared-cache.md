# Shared UI image texture ownership

The UI presenter now registers catalog-backed image textures with the existing
world texture-cache controller. Each physical UI owner holds an independent
ready decoded-image lease. Short hide/show transitions can reuse both resources;
active owners stay pinned, and idle owners follow the existing shared policy.
Sprite and UI samplers remain distinct physical owners. See
[ADR 0053](../decisions/0053-shared-ui-image-texture-ownership.md).

Root's manual review and two independent Codex source reviews are CLEAR on the
exact final `ui-gpu.js` SHA `bb45ffb6ad46d088fcc03fe6a00584e9c2af8c63464cd1b9b973c1d77a38c75d`.
Review found two intermediate P2 defects: an upload callback could recursively
publish a second owner, and a crop-diagnostic callback could recursively demote
an owner still used by the outer draw. Both have actual RED regressions. The
final whole-draw fence rejects nested draw while permitting context/reset
retirement and rejecting cancelled late adoption/submission.

The final focused suite passed 96/96. Root's final full Node suite passed 902
with zero failures and five skipped (907 total). Tests cover actual presenters,
broker and Three objects at controlled Canvas/GL boundaries, including 100
hide/show cycles, aggregate world pressure, active protection, TTL/cold reload,
sampler separation, failure cleanup and context/reentry cancellation.

Two bounded, read-only, tool-free Claude Code 2.1.308 attempts timed out after
45.287 and 90.339 seconds, exit 1, with no stdout/stderr. They captured earlier
392fdeab and 59675fc3 drafts, respectively. They are incomplete and do not cover
the final whole-draw correction; they are not passed external reviews. The final
correction has the separate exact-pin reviews above. Earlier test gates and
review dispositions remain preserved as superseded.

[The source evidence](../evidence/2026-11-03-shared-ui/ui-image-cache-source.json)
indexes 41 raw artifacts and records the working-set audit. The eight known
images have a 65.24 MiB union, exceeding the authored 64 MiB cache before other
owners, without proving simultaneous demand. Active-owner pressure and decoded
broker residency remain separate from idle reclamation. Engine build/retirement
counters are logical ownership measurements, not driver allocation measurements.

Actual official Web main/worker rendering and the seven Game scenes remain
pending for this slice. No Game, text raster key, Core or Native binary changed.
Windows Native final execution remains blocked by App Control 4551. No global
leak-free, no-frequent-GC or 60 FPS conclusion follows from these source checks.
