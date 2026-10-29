# Generic spatial diagnostics example

This standalone synthetic project demonstrates typed nearest/overlap/sweep queries,
structured input rejection and repair, next-tick delivery, JSON arrays and detached
cost diagnostics. It has no game rules or assets and does not change scene entities.
The default backend is CPU; headless execution does not create or test a GPU.

Copy this directory to a new writable location, keeping the installed SDK intact.
Use the CLI path from that SDK's `sdk.json`; do not assume a CLI from `PATH` matches.
With `$sdk`, `$game` and the official analyzer configured as in the SDK README:

```powershell
$project = 'D:/Experiments/spatial-diagnostics' # New destination you choose.
Copy-Item -LiteralPath (Join-Path $sdk 'examples/spatial-diagnostics') -Destination $project -Recurse
& $game --sdk $sdk --project $project api typings --update-script main.luau
& $game --sdk $sdk --project $project --json check --types
& $game --sdk $sdk --project $project --json run --frames 3
```

SDK packing generates the marked canonical type block, so a fresh SDK copy is
already ready for strict checking. The explicit refresh command also makes the
source checkout example usable without maintaining a second type declaration file.
Use the project copy for any edits; refreshing updates only the marked API block.

The final run observations contain `complete=true`, three hits with ID 10,
`result.results[4].hits=[]`, `empty_batch.results=[]`, `empty_array=[]` and
`plain_object={}`. `rejected_input` identifies `queries[1].radius` with retry
`after_correction`. All variant queries are explicitly typed before `table.insert`;
there are no casts, custom API stubs or publication adapters.

The example deliberately publishes wall-clock profiles for inspection. Those
values vary between runs; omit diagnostic publication when comparing deterministic
replay digests. For contract details and host selection read
[`docs/spatial-batches.md`](../../docs/spatial-batches.md).
