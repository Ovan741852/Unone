# Memory round-trip fixture

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

Measure it:

```text
game --project tests/memory-roundtrip-project export --target web --output <export>
node scripts/prepare-web-image-assets.mjs --project tests/memory-roundtrip-project --input-export <export> --output <export-with-groups>
node scripts/measure-web-export.mjs --export <export-with-groups> --output memory.json --scenario tests/memory-roundtrip-project/round-trip.scenario.json
```

`game test` covers the screen logic (`round-trip.test.json`, `battle.test.json`);
it holds no image groups, so the marks fire on the first update of each screen.
