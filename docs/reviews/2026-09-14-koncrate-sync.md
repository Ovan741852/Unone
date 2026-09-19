# Koncrate integration sync — 2026-09-14

Scope: merge fetched `origin/master` (`375b0987919bdb8a0771bcfed812f9bdfb0b41e7`)
into the existing local `master` (`7bc124931e6a6ed47ee28b6dc3e7bc7646d37b5d`).
No branch change, rewritten commits, push, or new engine capability.

## Preserved work and merge decisions

- The two modified documents and 86 untracked files were backed up byte-for-byte
  under `.git/koncrate-sync-2026-09-14/working-copy`, with SHA-256 inventory and
  the original tracked patch. A second copy is in the named stash
  `ea427a628de0fd8f1fadaeb0d671d54df0574d2c`
  (`koncrate-sync-2026-09-14-preserve-local-work`). The stash is retained after
  restoration as a recovery point, not consumed by the merge.
- Retained both ignore lists and the remote distinction between web-wasm,
  native-wgpu, and WebView packaging.
- Shared the remote presentation settings type while preserving the existing
  native UI/font packaging and selected-runtime SVG declaration gate.
- Preserved installed SDK paths/hashes/runtime descriptors alongside the new
  uniform target catalog. The catalog describes current host code; declarations
  from installed runtime bytes remain the actual compatibility evidence.
- Corrected the remote native-UI gap documents against the already implemented
  local UI/SVG host and its [recorded Windows evidence](2026-09-10-svg-sdk.md).
  Android/iOS UI device evidence remains unperformed.
- Retained immutable Web release generations and conditional-request handling,
  plus the remote HTTP/1.1 server and increased request queue.

## Verification

Run from this checkout:

```powershell
cargo test -p unone-cli
cargo test -p unone-engine --lib
node --test web/shared/canvas-ui.test.mjs web/renderer/bloom.test.mjs scripts/process-result.test.mjs scripts/unone-shader-fallback.test.mjs
```

- CLI: 58 passed across unit and integration suites, 0 failed.
- Engine library: 243 passed, 3 ignored, 0 failed.
- Node: 11 passed, 2 skipped, 0 failed. Skips require a separately installed
  `UNONE_SHADER_ROOT`; they are not GPU execution evidence.
- A local synthetic HTTP fixture confirmed GET/HEAD mutable-index responses are
  200/no-store despite a future conditional date, and generation JS/WASM responses
  have immutable caching and correct MIME types: 4 passed. It is not a game
  renderer or connected-device acceptance test.
- Python server syntax and conflict-marker/whitespace checks passed.

Detailed command logs and the small HTTP reproduction are retained locally in
`.git/koncrate-sync-2026-09-14/`. Existing Windows GPU evidence was not rerun:
this merge changes host metadata and packaging integration, not the renderer.

## Gateway/Host adapter conclusion

No additional Unone engine implementation is required for the first Koncrate
browser-to-device command and Web export preview path. The connected Host can
map narrow authorized actions to existing CLI argv:

```text
game --project <authorized-project> --json project inspect
game --project <authorized-project> --json platform snapshot
game --project <authorized-project> --json verify
game --sdk <verified-sdk> --project <authorized-project> --json export platform --target web --output <new-host-owned-directory>
```

The source-checkout alternative is `export web --runtime <matching-runtime>`.
The SDK path requires matching CLI/runtime/template hashes and must not bypass
the compatibility checks. Output must be a new directory. `game preview` opens
a native local window; it does not itself provide a remotely viewable webpage.

The Host should publish/relay the complete exported directory, preserving
`index.html`'s relative `releases/<sha256>/` base, transitive JS/WASM/assets, MIME
types, and cache policy. A local filesystem path or localhost URL on the device
is not a browser-accessible preview URL on another computer. Gateway/Host own
device authentication, project authorization, job state, bounded output,
artifact delivery, preview isolation, and audit; none belong in Core.

Scout supplies compact discovery, selected contracts/hashes, and argument
validation. It does not itself authorize or execute an operation. Keep the
existing host grant and mutation checks around the adapter. Billing remains a
Koncrate concern and no billing behavior was changed in this repository.
