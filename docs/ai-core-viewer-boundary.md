# AI Core and human Viewer boundary

Unone is Core-first: an AI should be able to inspect, edit, test, replay,
profile, and synchronize a project without opening a visual Editor. The project
repository remains the only content authority. A human-facing Viewer (such as
Koncrate Viewer) observes and controls a host; it does not become a second
project repository or a required AI runtime.

```text
AI → Unone Core + SDK/CLI/MCP → project repository
                         ↓
                 Host adapters (I/O, platform, remote machine)
                         ↓
                 Koncrate Viewer (human control/review)
```

## Ownership

| Concern | Owner | Boundary |
| --- | --- | --- |
| Runtime, deterministic tests, replay, perf, sessions | Core + SDK/MCP | Headless and machine-readable |
| Asset IDs, bundle manifests, hashes, generations | Core | Pure contracts and verification |
| Pack, verify, activate as one AI operation | SDK/CLI (`project sync`) | Composes existing Core operations |
| Directory scanning, copying, file watching, process lifecycle | Host | Platform and filesystem side effects |
| Tailscale, Keychain, Gateway, billing | Host/Gateway | Product and security policy |
| UI semantic tree, observation, layout contract | Core | Shared semantic surface |
| DOM/Canvas/WebGPU measurement | Host | Host-specific evidence |
| Animator lifecycle and renderer presentation hook | Core contract | Format implementations remain optional |
| GLB/Spine/Lottie decoders and playback | Plugins | Format/platform-specific |
| Camera shot schema and validation | Core | Stable AI-readable representation |
| Camera manipulation and prompt generation | Viewer | Human visual authoring aid |
| Skills, movement, rewards, money, root-motion policy | Luau | Game-owned behavior |

## The AI sync entry point

`game project sync --json` is the single authoring-to-runtime operation. It
performs the existing operations in a fixed, inspectable order:

```text
pack → verify → bundle install --all
```

The result keeps the pack report, every verify step, activation report, active
generation, effects, and diagnostics together. A failed verify never activates
a new generation. The command does not install plugins, contact a network, or
execute arbitrary shell commands; those remain explicit Host/Plugin actions.

MCP exposes the same operation as `unone_project_sync`, so an AI does not need
to memorize a multi-command recipe. The individual `asset describe` and
`bundle inspect` queries remain available when a narrower diagnosis is needed.

## Viewer contract

The Viewer may display source/export/active-generation state and issue
structured requests through the Host. It stores connection, review, and task
metadata, not copies of project source or assets. The same project can be used
by a headless AI, a local native preview, a Web preview, and a remote Viewer.

