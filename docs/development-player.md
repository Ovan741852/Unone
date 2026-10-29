# Development player and shared Lua tools

Production and development are distinct exports, both optimized release builds.
Development additionally enables the `preview-tools` feature; it does not enable the
editor/authoring `dev-tools` dependency. Production has no developer C ABI export,
no `web/developer` files, no panel or browser agent API. The game's authored Luau
is preserved; guard auxiliary registrations with `api.debug.enabled` (false in
production). Calling registration unguarded fails with `DEVELOPMENT_ONLY`.

```powershell
cargo build -p unone-cli
./scripts/build-web-live.ps1 -Player -Project <game>
./scripts/build-web-live.ps1 -Player -Development -Project <game>
./target/debug/game.exe --project <game> export web --output <production-directory>
./target/debug/game.exe --project <game> export web --development --output <development-directory>
```

Both variants select the same project systems; see [optional systems](optional-systems.md).
Production VMs default to Luau bytecode optimization level 2 even when executing
through the interpreter/Wasm; development keeps level 1 for sampler attribution.
This is separate from optional native machine-code generation. See
[execution-mode policy and parity](runtime-mode-validation.md).

Build scripts may update the invoking shell's SDK environment; run independent
build invocations from a fresh shell when selecting Node/toolchains. Runtime
manifests declare `preview_tools`; export rejects a mismatched variant. Both
variants run the actual exported payload parity gate. Development acceptance
additionally invokes registered Lua callbacks through the exported C ABI, checks
label/checkbox updates and rejects unknown IDs, stale revisions and malformed
requests. Production acceptance verifies the operation export is absent.

## Lua registration

Register in `Game.start`; callbacks capture the game API or game-owned state.
Registry metadata never enters `WorldSnapshot` or its digest. Registering a tool
does not invoke it. Tools are sorted by stable ID, with at most 16 tabs and 128
controls per runtime; IDs are 1..80 portable ASCII characters and text <=4096 bytes.
Duplicate IDs, unknown tabs, unknown fields and wrong callback/value types fail.

```lua
function Game.start(api)
    if api.debug.enabled then
        api.debug.registerTab({id="qa", label="QA"})
        api.debug.register({kind="label", id="qa.status", tab="qa", text="Ready"})
        api.debug.register({kind="button", id="qa.fire", tab="qa", label="Fire"}, function()
            pendingShot = true -- gameplay processes it on the next tick
            api.debug.set("qa.status", "Shot requested")
        end)
        api.debug.register({kind="checkbox", id="qa.move", tab="qa", label="Move targets", checked=true}, function(value)
            moveTargets = value
        end)
    end
end
```

`api.debug.set(id, value)` updates a label string or checkbox boolean without
calling its callback. Button callbacks receive nil; checkbox callbacks receive
the requested boolean. Label controls cannot be invoked. Invocation requires the
registry's current structural revision. Label/checkbox value changes do not change
that revision; new registrations and accepted script reloads do. A reload drops
old callbacks: register replacement tools in `Game.onReload` or reload the project.
Failed reloads keep the old registry. Registry closures use weak ownership to avoid
keeping an old VM alive through a captured game API.

Invocation occurs between ticks and may mutate the game immediately. It does not
advance time. A callback error is explicit, but cannot roll back arbitrary Lua
state: inspect the snapshot before retrying. Tool actions are recorded in a bounded
human/AI journal; they are not automatically inserted into ordinary InputFrame
replays. For reproducible tests, record/reapply tool invocations at their frames or
have the callback request normal gameplay input. Production gameplay must never
depend on the development registration branch.

## AI API first, panel second

Web exposes `window.unoneDeveloper.request(request)` and, on supporting browsers,
the WebMCP `unone_developer_request` tool. The human panel uses that same API.
There is no arbitrary JavaScript/Lua eval console. Start with `describe`, then
`tools.list`, then `tools.invoke` using the returned ID/revision. Responses use
`{ok,value,diagnostics,effects}`. Unknown methods/fields fail.

| Method | Useful evidence / action |
| --- | --- |
| `snapshot`, `hierarchy` | Actual world/component data and UI tree. Entity roots are flat until the engine has a parenting contract. |
| `console` | Game trace and Web console/error events. Browser entries and returned game logs retain the latest 200; engine trace is bounded to roughly 512 and individual game messages to 8192 bytes. |
| `network` | Last 200 resource timings, sizes, available status codes. No request bodies/headers. Zero transfer size is ambiguous (cache/restricted timing). |
| `profile` | Lightweight cached core counters and bounded Lua function samples, without a world snapshot/digest. Host CPU window and separate rolling renderer/GPU counters. |
| `profile.start` | Begin a fresh measurement window between ticks. Optional `sampling: true` enables automatic Luau function/stack sampling. An already active window is an explicit error. |
| `profile.stop` | Freeze the core and host measurement windows and remove the Lua interrupt hook; does not pause gameplay. |
| `instances.transport` | Web-only A/B control: `mode: "memory"` or `"json"`. Republish and redraw the same frame without advancing gameplay. |
| `memory` | Luau used bytes; Web WASM capacity and optional JS heap separately. WASM capacity is not live usage. No invented native RSS or GPU byte totals. |
| `tools.list`, `tools.invoke` | Discover and invoke the exact Lua controls shown to humans. |
| `pause`, `step` | Pause/resume; advance 1..120 exact ticks only while paused. |
| `input` | Validate and queue one normalized input frame without advancing time. |
| `bloom` | Web renderer toggle. CLI primitive preview returns `CAPABILITY_UNAVAILABLE`; restarting cannot enable it. |
| `journal` | Last 200 tool/control requests, frame and outcome; failed callbacks may have partial effects. |

Core request/definition schemas are generated from Rust (`preview-request`,
`debug-tab`, `debug-control`); host request discovery is in `web/developer/api.js`.
The panel polls while open and stops polling when collapsed. Inspection/rendering
has overhead: close the panel for representative play measurements. GPU timers,
browser network/heap and drawing counts are not portable simulation facts.

## Native companion panel

```powershell
./target/debug/game.exe --project <game> preview --tools-port 8190
```

Open `http://127.0.0.1:8190/`. The companion panel talks to the **same native
EngineRuntime in the game window**, not a WASM replica. The native event loop
serializes requests between ticks. AI can POST the same JSON methods to `/request`:

```json
{"method":"tools.list"}
```

The server binds loopback only, validates Host/Origin, accepts JSON POST commands
up to 64 KiB, and has bounded queue/deadlines. It serves only its explicit UI files.
It does not expose filesystem reads, shell execution or game source writes.
Native supports hierarchy, Lua log/profile/memory, registered tools, pause/step and
normalized input. Browser network, JS heap and WASM memory remain unavailable;
CLI primitive preview does not support Bloom. The companion browser's own heap is never
reported as native game memory.

The CLI `preview` renderer (`renderer: "cli-primitive-preview"` in `describe`)
draws debug geometry, not the full game presentation. Its companion tools inspect
the real simulation but do not establish visual parity with Web.

The separate `unone-native-player` supports mesh/instance batches, sprites,
particles, non-DOM UI and configured Bloom via `player.presentation.json`.
It does not expose this CLI companion endpoint. Do not infer one host's supported
tools, asset decoders or rendering capabilities from the other host.

WebMCP is optional transport; the JavaScript and native HTTP APIs remain usable
without browser support. Plain HTTP LAN pages may lack the browser's secure-context
WebMCP capability; use HTTPS or localhost for that transport. Registration follows
the [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api),
with detection for older navigator-based implementations.

## Verified on 2026-09-08

### On-demand viewport screenshots (Web and native)

Both development hosts expose `{ "method": "screenshot", "max_width": 1280,
"max_height": 720 }` through the same API and the panel's **截圖** button.
Dimensions are optional integer bounds (16–2048); aspect ratio is preserved and
small viewports are not upscaled. Unknown fields and unsupported captures fail.
The result contains a PNG `data_url`, `width`, `height`, simulation `frame`,
`observation_digest`, `host`, `source`, `scope: "game_viewport"`, and
`includes_ui: false`. It excludes DOM UI, developer panels and desktop chrome.
Use hierarchy/UI state separately; this is not a full-window screenshot.

Web calls `window.unoneDeveloper.request(...)`; native accepts the same JSON at
its loopback `/request` endpoint. AI may decode the returned base64 PNG directly.
Pause first when comparing captures and state. Capture does not advance simulation
or execute Lua. Web renders then reads the canvas immediately; native renders the
same vertex/draw path to an offscreen target. GPU readback/PNG encoding occurs only
on request, can stall that request, and is not part of normal frame processing.
This adds no screenshot dependency or API to production Web exports.

The CLI native preview uses primitive debug geometry, not Web's textured
Three/Effekseer presentation. Screenshot availability does **not** establish
visual parity. Frame/digest identify simulation state, not pixel equality.

Actual WebMCP and native HTTP captures were inspected at frame 813, 960 × 540.
Both returned `sha256:cf4404cd5ae5fe72077960df6662f0fcfe6a875ca401bc4728a1c3c65d224b66`,
with visibly different native/Web output. Both panel buttons displayed PNGs.
CLI unit tests: 18 passed; developer JavaScript tests: 3 passed. Actual exported
development payload parity passed, including audio and physics negative controls.

### Earlier development-tools baseline

Workspace tests: 231 passed, 1 ignored. JavaScript developer API tests: 2 passed.
Both optimized player variants passed actual exported-payload parity, including
the audio-omission negative control. The development fixture also exercised Lua
button/checkbox callbacks and malformed/stale requests through its exported ABI.
The actual demo export matched CLI replay digests at both fixture frames.

Uncompressed core WASM: production 1,438,761 bytes; development 1,537,242 bytes.
These sizes exclude JavaScript, Three, game assets and optional Effekseer.
Web panel checks covered shot callback, one-frame stepping, checkbox and hierarchy.
Native WebMCP invoked the same Lua shot callback in the actual native process:
frame 5023 stayed unchanged by invocation, then stepping reached frame 5024 with
shots=1 and flying_bullets=1. Its loopback HTTP server was tested on Windows;
accepted sockets explicitly return to blocking mode before bounded HTTP reads.
This verifies tools and state, not native visual parity or release native timing.
