# Memory and frame-time fixture

Four screens, each owning an image group from `player.image-assets.json`, switched
by keys so `scripts/measure-web-export.mjs --scenario` can drive real screen changes
in an exported official Web player and watch the memory owners:

```
city --T--> tech --B--> bag --Escape--> city
city --F--> battle --Escape--> city
```

City keeps its group loaded. Tech, bag and battle load their group on entry and
unload it on exit; battle also spawns 41 world sprites and despawns them on exit.
Each entry calls `api.profile.mark("<screen>.interactive")` once its group is
ready, which is what `round-trip.scenario.json` waits for.

The PNGs are striped RGBA images (a few KB each) whose decoded sizes are real:
city 5 MiB, tech 5 MiB, bag 3 MiB, battle 4.5 MiB as width × height × 4.
The scenario settles for 45 s, longer than the renderer texture cache's default
idle limit (1800 drawn frames), so the settled checkpoint shows whether idle
textures are retired.

Measure it:

```text
scripts/build-web-live.ps1 -Player -Project tests/memory-roundtrip-project -OutputRoot <runtime>
game --project tests/memory-roundtrip-project export web --runtime <runtime> --output <export>
node scripts/prepare-web-image-assets.mjs --project tests/memory-roundtrip-project --input-export <export> --output <export-with-groups>
node scripts/measure-web-export.mjs --export <export-with-groups> --output memory.json --scenario tests/memory-roundtrip-project/round-trip.scenario.json
```

`game test` covers the screen logic (`round-trip.test.json`, `battle.test.json`);
it holds no image groups, so the marks fire on the first update of each screen.

A three-run measurement of this fixture is in
`docs/evidence/2026-11-15-web-export-memory-roundtrip.json`.

More screens drive frame windows (`frame-tail.scenario.json`): `E` opens a screen
that draws only its title (the minimal-player control), `M` a world map dragged
with the pointer, `L` a scroll view of 40 image rows, and battle moves its 40
units every tick. Add `--scenario tests/memory-roundtrip-project/frame-tail.scenario.json`
(and `--scenario-runs 3 --scenario-profile`) to the measure command.

Frame-window measurements of this fixture are in
`docs/evidence/2026-11-15-web-export-frame-tail.json` (and a first batch with one
unexplained stall in `docs/evidence/2026-11-15-web-export-frame-tail-first-batch.json`).
