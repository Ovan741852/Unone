# Portable SDK acceptance — 2026-09-08

Branch: `codex/portable-core-sdk`. This change packages the closed Core CLI and
precompiled Web runtimes with an explicit host-template inventory. Web exports no
longer read the publisher's compiled-in repository path. Native plugin discovery
also no longer references that path. No gameplay behavior changed.

## Evidence

- A release CLI packaged 42 manifest-listed files plus sdk.json. Both production
  and development Web runtimes were included. No Rust sources/build caches/games.
- SDK and Jobs Lab copied outside the repository, executed from an empty cwd.
  Thirteen acceptance checks passed, including two Web exports, unsupported
  targets, unavailable runtime ID/capability, corrupt hash and unknown schema key.
- Actual browsers loaded those relocated exports. Both variants matched all 30
  tick digests across inline and two real compute Workers with main/worker
  simulation placement. Final digests matched the relocated packaged CLI.
- CLI unit tests: 21 passed. All CLI integration tests also passed.
- The ZIP is 10,114,941 bytes; a separately extracted copy passed SDK inspection.

[Machine-readable checks, hashes and runtime identities](2026-09-08-portable-sdk-evidence.json).
SDK/CLI were built from the uncommitted branch implementation before this report.
The manifest pins each binary by hash; runtime source identities remain those of
the separately supplied verified builds. The contract does not infer binary
compatibility from a shared branch name.

## Limits

This is Windows x86_64 tooling exporting Web, not a native Windows game exporter.
Android/iOS/Windows SDK packagers are explicitly unavailable. No claim of mobile
renderer parity, signing, store submission, public release or automatic downloads.
The fixture's trimmed runtime capabilities are listed; this example SDK cannot
export a physics-enabled game without another compatible runtime pack.

The relocation test uses the same computer. The original repository stayed in
place; explicit code removal and executable-relative discovery establish path
independence, while a clean second-machine test remains a release qualification.
Runtime signatures and complete publisher licensing/notices are outside this
local packaging acceptance. Core source visibility has not been changed.
