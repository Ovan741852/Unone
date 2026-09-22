# Reproduction probe handoff

`replay-probe.mjs` is a separately authored, **not executed** reproduction of the already completed first-use requests. It is not part of the frozen initial evidence, and it does not read that evidence or any audit/rubric/source file. The parent should review this script before running it.

Invocation after review:

```powershell
node C:/Users/liNao/AppData/Local/Temp/unone-public-core-845180e493514dc38b934b3526692ee2/replay-probe.mjs --root D:/Projects/Unone
```

External inputs are an installed Node.js (built-ins only), the exact existing `target/release/game.exe`, an OS temp directory resolving to C:, sufficient writable temp space, and the host OS/scheduler/inherited environment. No package install, source checkout reading, external service, account, browser, GPU, provider or network is used. A SHA-256 guard stops if the binary differs from the first-use binary. It does not rebuild or choose another binary.

The script creates a fresh `unone-core-replay-*` directory under C: OS temp on each invocation. It only creates/reads that new fixture and writes its own logs. It never deletes data. Child processes use `windowsHide:true`, bounded timeouts and piped stdio. Normal cleanup sends EOF to its own transport; on timeout/failure it terminates only child objects it spawned. The original exploratory transport cleanup was different and remains honestly described in the frozen report.

The repeat covers help, empty-project snapshot failure, init, schema and API discovery, rejected init retry, initialized capability snapshot, plus all 22 original session requests. Session IDs, revisions and replay recordings are taken from preceding real responses. Expected semantic errors are checked; the intentional `framse` field is removed in the next request. Rejected revision does not double-step, two watch pages use returned next_cursor, dry-run is inspected before commit, accepted input/enact commands replay identically, current session survives replay, and reopening rejects the old ID and restores authored state. Fixture hashes are compared. Timings are recorded but exact timings or improvements are not asserted.

The only original once-off CLI omitted is `verify`: its types gate required a separate unavailable `luau-analyze`, whereas this repeat is constrained to invoking the same game binary. No type-check success will be implied. Hence this repeat has 30 operations including transport startup, rather than the original 31. Exact original verify output remains in the frozen raw logs.

No run, dry run, syntax-check invocation, recording or second blind exploration of this script was performed by the author. Any future run is a new reviewed reproduction and must retain its own output directory.
