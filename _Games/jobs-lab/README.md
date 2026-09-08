# Jobs Lab

A real game-owned batch job example with four animated 3D bars. Each update
submits four 1024-value integer field computations. The following update consumes
results; default verification independently recomputes and compares every output
byte. Algorithms and visualization live in `main.luau`.

From the repository root:

```powershell
cargo run -p unone-cli -- --project _Games/jobs-lab test --json
./scripts/build-web-live.ps1 -Player -Development -Project _Games/jobs-lab
./target/debug/game.exe export web --project _Games/jobs-lab --runtime _Games/jobs-lab/dist/player-development-runtime --development --output _Games/jobs-lab/dist/player-development --json
python scripts/serve-player.py _Games/jobs-lab/dist/player-development --port 8212
```

The development tools tab offers job/direct-Luau selection, byte verification,
submission pause and reset. AI can invoke the same registered controls using the
developer API and read `profile.jobs`. Disable verification before measuring;
verification deliberately duplicates computation. The direct-Luau option uses the
same next-update presentation delay, but has no isolated VM execution overhead.

Native uses two background threads. Web currently uses an inline executor and
provides parity/usability, not a Worker speedup. Production export uses the same
job API without the developer menus. See the authoritative [contract](../../docs/jobs.md)
and [measurement report](../../docs/reviews/2026-09-08-luau-jobs.md).
