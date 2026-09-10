# Warm-cache upgrade regression — 2026-09-10

Trigger: YesSir reproduced `HOST_PROJECT_REJECTED: unknown field asset` in an
existing IAB tab: new project/UI schema combined with cached older WASM. Clean
Edge acceptance had passed and therefore missed this deployment/cache failure.
This is host/export responsibility, not gameplay or a reason to rerun combat parity.

## Fix

Web exports now seal the complete host import graph, JS/WASM pair, content and assets
under `releases/<sha256>/`. Root `index.html` uses a base URL for that generation.
Its template and sorted path/content hashes determine identity. Main loads assets,
fonts/runtime against `document.baseURI`; JSON requests use no-store. Restart in an
open page remains pinned to that generation instead of mixing in new source data.

Unversioned files are temporarily retained as compatibility aliases for existing
CLI inspection/parity tools; the browser entry does not load them. This costs extra
disk/package bytes. Removing aliases requires migrating those consumers first.

Deploy the **complete generation before replacing index**, revalidate the mutable
index and retain old generations for open clients. `export.json.cache_policy`
describes this requirement; exporting files does not configure a third-party CDN.
`serve-player.py` now uses no-store for mutable paths and immutable caching for
generation paths. It strips conditional validators on mutable paths to avoid a
false same-second Last-Modified 304. A previously cached legacy unversioned index
still needs one revalidation/reload during migration; this is not retroactive cache
purging or a service-worker migration mechanism.

## Fixed acceptance IDs

| ID | Evidence/result |
|---|---|
| CACHE-001 | Release unit test: file order stable; changing JS, WASM, host, content or index changes generation; conflicting base rejected |
| CACHE-002 | Actual IAB A page: SVG visible, frame 919, no error |
| CACHE-003 | Same tab ordinary reload A: 20/23 boot resources transfer zero bytes; frame 407, cache actually warm |
| CACHE-004 | Publish B, same tab ordinary reload without clearing cache: title B, frame 1097, no error, all recorded resources in B generation |
| CACHE-005 | B JS and WASM both have changed bytes/hash and both loaded under B; HTTP log agrees |
| CACHE-006 | Official local server returns 200/no-store for index even with future If-Modified-Since; generation content returns immutable |

[Browser observations](2026-09-10-warm-cache-browser.json),
[runtime HTTP identities](2026-09-10-warm-cache-http.json).
Full outputs are retained at `D:/Projects/UnoneAcceptance/2026-09-10-warm-cache-01/`:
A/B exports, projects/runtime fixtures, export reports, server log and browser evidence.
The B runtime adds only a JS comment and valid WASM custom section: identities
change while Core semantics remain identical. This tests cache isolation, not a
new Core schema implementation. Both SVG screenshots were inspected inline.

Reproduce with `node scripts/serve-cache-upgrade.mjs --cli <release-game.exe> --runtime <web-runtime> --output <new-directory>`.
Open its URL, reload A once, POST `/__switch/B`, reload the same tab ordinarily,
record title/frame/error and resource generation paths. Do not clear browser cache.
Stop the local server after collecting results. The harness changes only copied
fixtures; it does not publish a game or alter YesSir's files.

CLI release unit suite: 37 passed. Debug relinking hit an existing MSVC PDB LIMIT
error; no PDB/build-tree deletion or global compiler workaround was performed.
Main-thread browser backend was tested. Worker warm upgrade, actual CDN/service
worker policies, mobile WebViews and legacy-index migration remain separate cases.
Existing 19-case gameplay parity and native SVG acceptance were not rerun because
this change affects Web URL identity/serving, not those runtime behaviors.

Claude current-source review of sealing/baseURL resolution found no confirmed
high/blocker defects (read-only source audit, not a git-diff review). Temporary
browser tab and both local test servers were stopped after acceptance.

Separate follow-up, not this cache failure: YesSir reported iPhone `fetch for ...`
errors. Its `tests/REMOTE-LOAD-FIX.md` records bounded GLB concurrency/retries and
mobile-width error text, with HTTPS Edge fault injection (503 recovers; 404 does
not retry). Real iOS was not verified and the original phone status was truncated.
Do not mislabel that transport failure as `unknown field asset`, or treat a mobile
viewport test as iOS acceptance. Its report remains the source for that work.
