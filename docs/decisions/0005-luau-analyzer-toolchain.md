# Decision 0005: The Luau Analyzer Is a Development-Time Tool, Not Game Runtime

## Decision

Unone's game runtime embeds a Luau executor; the official `luau-analyze` performs complete type checking during development/CI. The CLI provides `game check` for syntax + the entrypoint contract, while `game check --types` additionally starts the analyzer.

## Rationale

- Type analysis is a development-time requirement and should not increase the size or attack surface of iOS, Android, or Web game binaries.
- Use the official analyzer directly instead of rewriting or incorrectly simulating the Luau type system in Rust.
- Missing or failed analyzer execution must produce an explicit diagnostic; runtime executability must not be presented as completed type checking.

## Version Risk

The runtime uses the Luau vendored by `mlua`; the analyzer is a separate executable. CI must pin and record the language versions, flags, and standard-library settings for both, or they may drift so that “the analyzer passes but the runtime rejects it,” or the reverse. The first phase provides an adapter only for the entry script; multi-module dependencies and generated API contracts will be added when an actual game needs them.

## Local Verification

This work used the official Luau 0.734 Windows binary, stored in `.toolcache/`, which is excluded by `.gitignore`; it passed type checking for `minimal-2d/scripts/main.luau`. The binary is not committed to the repository.
