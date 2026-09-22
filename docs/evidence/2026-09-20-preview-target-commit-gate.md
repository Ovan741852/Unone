# Preview target switch: commit gate

2026-09-20. Scope: submit the verified Web/Windows target switch and the native
presentation/Camera foundation it uses, without sweeping other pending work
into the commit. The earlier runtime/device evidence remains in
[the acceptance record](2026-09-19-preview-target-switch.md).

## Source isolation

- Fast-forwarded `master` to remote `da415a1`; the three incoming commits affect
  `_Games/ashen-legion`. No overwrite of ignored files was permitted.
- Foundation checkpoint: `6695c80` (unified Camera, native presentation and
  sprite batching, readiness, related schemas/tests).
- Tested staged source tree: `7c14afc1782a684a63fd06fb8937ce79e98ba63e`.
  The snapshot contains only indexed files, not the surrounding dirty worktree.
  This record is added after that code/test tree was verified.
- Working copy of the snapshot and logs:
  `C:/Users/liNao/AppData/Local/UnoneBuildCache/commit-check-20260920/`.
- Isolation caught two omitted dependencies: the particle part of the developer
  schema, and the registered particle preset JSON fixtures. Both were included;
  tests were rerun. The unrelated pending `diagnose` schema extension remains
  uncommitted with its implementation.

## Results on the isolated source

| Suite | Passed | Failed | Explicitly ignored |
| --- | ---: | ---: | ---: |
| CLI binary unit tests | 53 | 0 | 0 |
| Engine library | 253 | 0 | 3 |
| Particle follow integration | 1 | 0 | 0 |
| Particle presets integration | 1 | 0 | 0 |
| Native player library | 18 | 0 | 1 |
| Web particle renderer | 1 | 0 | 0 |

The standalone snapshot uses the pre-existing cached dependencies, but rebuilds
the modified crates from the snapshot. CLI count is 53 rather than the earlier
dirty-worktree 54: an unrelated pending debug-preview window-size test is not
part of this submission. Ignored GPU/font/fixture-dependent cases are not
reported as executed.

Koncrate-Editor source commit `954f23b` was separately retested: 420 passed,
18 existing environment-specific skips, 0 failed; the Unone plugin suite adds
3 passed. Its working tree was clean after committing. Actual BlueStacks TEST
App and Windows/Web UI acceptance were completed on 2026-09-19; this gate does
not claim another device run or a new binary release.

## Preserved scope

Pending runtime-mode/diagnose/Scout changes, the Wuxia sandbox, developer UI work
and unrelated investigation notes were left untouched. No branch was created,
no force push is needed, and this operation does not build/install a new Viewer
installer, publish an SDK binary, deploy Cloudflare, or clean preview generations.
