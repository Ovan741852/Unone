# Exported Web preview fails strict module MIME checks

Date: 2026-10-16. Baseline: `594ca455ae2800ca4dd5d8a903f42a0c0972b569`.

## Reproduction and impact

The user's actual Harbor URL, http://127.0.0.1:8344/?sdk=fresh-ui-verified,
was served using the documented `python -m http.server` command. On this Windows
host, Python's system MIME registry returned `text/plain` for `.mjs`. All six
imported modules were rejected by the browser. The page stayed at Loading and
never requested the production WASM. This was an actual preview delivery failure,
not a defect in the authored UI tree or its held/drag/selection state.

The preceding 363-check browser acceptance used the observer's own HTTP server,
which explicitly maps module MIME. It established exported player behavior but
missed the real server used for the user-facing URL. The later SDK smoke likewise
used `--export`, which self-hosts. Neither was acceptance of the delivered URL.
The original results remain unchanged and their scope is corrected here.

## Shared correction

The repository already had `scripts/serve-player.py` with explicit module/WASM
MIME. Reuse that helper instead of adding another server or a game-specific host.
The SDK now bundles its compiled source beside its README and browser tools, and
current SDK/example/source discovery routes recommend it. Existing positional
directory arguments, default port 8190 and hashed-release immutable caching remain
supported. Named `--directory` and `--no-cache` provide an explicit consumer route;
no-cache forces fresh headers even when a previous server cached the same files
with an incorrect MIME. No exported player file, UI package, renderer or runtime
ABI is rewritten. `project prepare`'s static root/entry descriptor is unchanged.

Observatory's portable launcher resolves the helper from its explicitly selected
SDK and gives an actionable message when an older SDK lacks it. It does not
fall back to a host-dependent MIME server. Source-host documentation retains its
original server root and URL relationship. External hosts must supply JavaScript
MIME for `.js`/`.mjs` and `application/wasm` for WASM.

Real-host validation uses the observer's `--url` **without `--export`**. Passing
`--export` selects the observer's own server and cannot test an external host's
response headers. The two checks have different purposes and are documented.

## Regression and review

Three standard-library HTTP tests exercise GET/HEAD under deliberately wrong
system MIME registrations, uppercase module extensions, byte preservation,
conditional cache requests, preserved immutable releases and no-cache refresh.
The SDK packaging regression verifies the helper is listed/hash-protected while
older SDKs without the convenience file remain supported. Python's older
`Path.relative_to` plus ValueError is used rather than introducing a Python 3.9
requirement through is_relative_to; the independent reviewer caught that initial
compatibility regression before shipment. Known positional callers and the
portable launcher were reviewed read-only; no other concrete issue was found.
The final implementation was exercised with Python3.12, not an actual 3.7/3.8 host.

The prescribed bounded Claude 2.1.280 fixed-diff attempt timed out after 56.1s
(exit 124, no output). It is not a completed review; exact invocation, fixed diff
hash and raw empty responses are preserved. Its snapshot preceded the compatibility
correction and remaining documentation cleanup, and no Claude approval is claimed.

## Actual URL acceptance

An independent browser tester first reproduced six strict MIME errors at the
unchanged user URL, then retested that same URL after replacing only the verified
old preview process. At 1440x900, 1020x884 and 390x844 all 36 assertions passed:
25 JS/MJS responses per viewport were text/javascript; the WASM response was
application/wasm; official three-webgl and production simulation advanced.
Actual pointer hold/release produced exactly one edge each with both readers
agreeing, slider moved 72→23, Studio selection worked and real wheel input changed
the virtual window. No console/page/request/HTTP/fatal errors were recorded.
All three after screenshots were actually inspected and readable. All 72 exported
files (5,091,752 bytes) had identical SHA256 before/after. This check includes the
real host that failed, rather than substituting a self-hosted QA export.

See [before/after summary](../evidence/2026-10-16-web-player-mime/summary.json)
and [response/input evidence](../evidence/2026-10-16-web-player-mime/after.json).
Screenshot pixels remain in ignored artifacts with a committed hash inventory.
SDK consumer/inventory and final build results accompany these records.

The final SDK has 65 hash-verified inventory files. Its bundled helper is
byte-identical to the canonical source and was executed as a real subprocess
using both named and legacy positional directory syntax. Six actual HTTP checks
confirmed JS/MJS/WASM MIME and exact response-byte hashes. The two ephemeral SDK
servers were terminated; the repaired user preview remains available on 8344.
All SDK Rust unit tests, workspace Clippy with warnings denied, and the release
CLI build passed. See [validation](../evidence/2026-10-16-web-player-mime/validation.json)
and [SDK consumer](../evidence/2026-10-16-web-player-mime/sdk-consumer.json).

The later [visible-track and content-drag correction](2026-10-16-ui-pointer-gestures.md)
changes the example and shared host templates and therefore produces a new export
generation. The byte-identical before/after claim above applies to the MIME-only
stage, whose evidence is frozen; it does not claim that later gesture changes
retain the earlier export bytes.
