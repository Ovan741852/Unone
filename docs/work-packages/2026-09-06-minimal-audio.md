# Work package: minimal Web-first audio

Date: 2026-09-06

Status: design only; bounded for independent review

## Decision and scope

The first real audio playback target is the generic Web runner. The shared engine
contract is platform-neutral and deterministic, but the first host that is
required to produce audible output and playback evidence is Web. Native desktop
and Android are explicitly deferred and are not blockers or acceptance targets
for this work package.

The smallest useful vertical slice is:

1. A game calls audio.play with an asset id, volume, and loop flag and receives a
   deterministic opaque handle.
2. The engine publishes bounded audio intents in the WorldSnapshot and digest.
3. The Web runner reads the exact audio bytes from the active, verified bundle
   generation, decodes them, and uses the Web Audio API to start and stop
   voices.
4. A non-looping voice is removed by the host when its source naturally ends;
   the engine does not retain a completed one-shot or wait for device time.
5. The Web host reports actual output state, including autoplay blocking,
   without putting device state into the deterministic world.

This is not a mixer, editor, 3D audio system, or game audio policy. It does not
define buses, categories, ducking, master volume, panning, spatial attenuation,
doppler, pitch, seek, cross-fade, fades, music policy, prioritization, or a
game-facing completion callback.

## Product decisions still open

These decisions are not settled by the current repository and should be
confirmed before implementation:

1. Codec allowlist and metadata. The current manifest has no audio kind and the
   repository has no audio decoder dependency. Recommendation: make the first
   Web evidence fixture a small self-contained PCM WAV and support only an
   explicit, documented allowlist. Decide whether the allowlist is inferred from
   the source suffix or declared with a future MIME/codec field. Do not imply
   MP3, Ogg, or native decoding support until each is tested.
2. One-shot behavior while autoplay is blocked or an audio buffer is not ready.
   Recommendation: drop the one-shot and report the reason; retain only the
   desired state of loops for later reconciliation. A queued one-shot policy
   would need a finite queue, expiry semantics, and a stated non-deterministic
   replay policy before implementation.
3. The exact transport and schema for the Web host output report. The
   recommendation in this document is a host-owned audio report outside the
   WorldSnapshot and observation digest, with stable English state and reason
   codes.

Native decoder/output backend and Android playback API are deferred platform
decisions, not blockers for the Web-first slice.

## 1. Capability audit

The current repository provides the deterministic and bundle primitives needed
for the boundary, but it does not currently implement audio.

| Surface | Current capability | Consequence for this work package |
| --- | --- | --- |
| Engine runtime | Fixed 1/60 simulation, deterministic snapshots and SHA-256 observation digests, script reload, and session-scoped systems | Add audio intents to the same deterministic boundary; never add device clock data |
| Engine systems | Optional system descriptors, HostRequired status, stable API tables when disabled, and SYSTEM_DISABLED diagnostics | Add an optional HostRequired audio system with a disabled path |
| Engine API/types | Entity, input, physics, camera, UI, save, animation, and effect APIs; no audio API | Add the minimal audio.play and audio.stop surface in both canonical Luau type copies |
| Asset manifest | Version 1, project-relative source and companion paths, bundles, active generations, and verified archive reads; current kinds are texture2d, mesh3d, spine, and effekseer | Add audio as a validated kind and keep decode in the host |
| Bundle path | pack_project creates deterministic uncompressed bundles such as bundles/content.bundle with per-entry hashes; Web IndexedDB stores and verifies active generations | Web playback must consume readActiveAsset from the active verified generation |
| Web runner | Generic project loading, active bundle installation, verified asset bytes, WebGPU rendering, input, save, and script reload; no audio | This is the first actual playback host |
| Web snapshot host | web/host is a static snapshot bridge and explicitly not a live loop | It cannot be playback evidence |
| Web live smoke | Live WASM ABI already transports systems, project/script/scene, ticks, reload, snapshots, and digests; no audio host adapter | It can carry core regression coverage; actual audio evidence belongs to web/runner |
| Native preview | WGPU flat-rectangle preview and SVG asset decoding; no audio backend | Defer native playback and do not call this slice incomplete because of it |
| Android package | Lifecycle, input, Canvas smoke drawing, and mobile FFI; no asset bundle host or audio | Defer Android playback and build evidence |

The generic Web runner currently has a further systems boundary to close:
the live Web ABI accepts a systems map, while the generic runner load payload
must include the project systems configuration when the audio system is added.
Otherwise systems.audio=false could not be honored consistently. This is an
implementation touchpoint, not a reason to add a native or Android dependency.

## 2. Ownership boundary

| Owner | Owns | Must not own |
| --- | --- | --- |
| Game script | When to request a sound, which stable asset id to use, and any game-specific timing or policy | Browser APIs, device clocks, decoder state, or host retries |
| Engine core | Argument validation, deterministic handles, bounded intents, loop desired state, fixed-frame correlation, systems disable behavior, and snapshot/digest serialization | File decoding, AudioContext, wall-clock duration, output route, autoplay permission, or audible success |
| Asset/bundle layer | Declaration, project-relative source paths, bundle assignment, archive hashes, active generation, and fail-closed bytes | Codec detection beyond manifest validation, decode, cache policy, or device output |
| Web host | Active-generation byte retrieval, decoding, AudioContext and source/gain nodes, per-voice volume and loop, natural-ended cleanup, reset, and host diagnostics | Mutating the deterministic world or inventing a successful play event |
| Browser/user gesture | Autoplay permission and output availability | Deterministic game state |

The engine accepts an intent even when the Web device is unavailable. The host
must make that distinction visible: an accepted core intent is not proof that
sound was audible.

## 3. Shared core contract

### 3.1 System descriptor

Add a system with these semantics:

| Field | Value |
| --- | --- |
| id | audio |
| status | HostRequired |
| optional | true |
| default_enabled | false while Web is the only supported playback host |
| Luau API | api.audio.play, api.audio.stop |
| observation | world.audio |
| when disabled | Preserve api.audio table shape; each call returns SYSTEM_DISABLED and produces no audio intent |

System resolution remains session-scoped. A project enables it with
systems.audio=true. There is no runtime toggle. A full project load with the
system disabled must also cause the host to stop and clear any voices left from
the previous session.

The choice of default false prevents a project from silently depending on
playback in a host that has not implemented it. It can be reconsidered after
host parity, but changing the default is outside this slice.

### 3.2 Luau API

The proposed public type is:

~~~luau
export type AudioOptions = {
  volume: number?, -- finite linear gain in the inclusive range 0..1; default 1
  loop: boolean?,  -- default false
}

export type AudioApi = {
  play: (asset: string, options: AudioOptions?) -> string,
  stop: (handle: string) -> (),
}
~~~

Contract details:

- asset is a stable declared asset id such as
  asset://audio/ui/click. It is not a source path, URL, Blob URL, or bundle
  filename.
- volume defaults to 1.0 and is a linear per-voice gain. Non-finite values
  and values outside 0..1 are rejected; they are not silently clamped.
- loop defaults to false. It is fixed for that voice. Changing it means
  stopping the old handle and playing a new one.
- Every accepted play call creates a new handle, including repeated calls with
  the same asset and options. A handle is session-local, opaque to the game,
  and deterministic in call order, for example audio-1, audio-2, and so on.
- Handle allocation uses a checked monotonic integer and never wraps. The
  counter is reset when a new runtime session is loaded and is preserved across
  script hot reload.
- stop is idempotent and returns no value. It publishes a stop intent for the
  supplied non-empty handle; a stale or already naturally completed handle is
  a safe no-op at the host. A return value must not pretend to report device
  playback state.
- A one-shot handle does not remain in core state after its play event is
  published. This allows a game to stop a still-playing host voice without
  requiring the engine to keep every one-shot forever.
- Audio is not attached to an entity and carries no position. There is no
  implicit relation between a 2D transform and a voice.

Suggested stable diagnostics are AUDIO_ASSET_ID_EMPTY,
AUDIO_VOLUME_INVALID, AUDIO_HANDLE_EXHAUSTED, AUDIO_EVENT_LIMIT,
AUDIO_LIVE_LOOP_LIMIT, and SYSTEM_DISABLED. Existing diagnostic conventions
remain authoritative; these names are design candidates until implementation
reviews the code table.

### 3.3 Deterministic snapshot shape

WorldSnapshot gains an optional audio value. It is omitted when there are no
events and no active loops:

~~~json
{
  "audio": {
    "events": [
      {
        "kind": "play",
        "handle": "audio-1",
        "asset": "asset://audio/ui/click",
        "volume": 0.8,
        "loop": false,
        "started_frame": 12
      },
      {
        "kind": "stop",
        "handle": "audio-2"
      }
    ],
    "active_loops": [
      {
        "handle": "audio-3",
        "asset": "asset://audio/music/ambient",
        "volume": 0.5,
        "started_frame": 10
      }
    ]
  }
}
~~~

The exact field names above are part of this proposed contract:

- events is an ordered, bounded list of play and stop commands created by the
  current engine boundary. The order is the order in which the calls were
  accepted.
- active_loops is the authoritative desired set for looping voices, sorted by
  handle. It contains no one-shots.
- started_frame is the engine fixed-frame number at which play was accepted,
  using the same convention as existing started_frame presentation state. It
  is a correlation value, not a wall-clock start time and not an instruction
  to seek.
- Events are transient. The engine clears the event buffer before the next
  simulation or reload boundary, records calls made by that boundary, and
  leaves the resulting snapshot stable for repeated observation reads. The
  host consumes snapshots in order and must not treat an old snapshot as a
  durable queue.
- A loop produces one play event and then remains in active_loops until stop.
  A stop removes it from active_loops and produces one stop event.
- A one-shot produces one play event only. It is naturally completed by the
  host and never becomes a growing core list.
- The audio value is included in canonical observation serialization and
  therefore in the digest. Host status, decoded duration, currentTime,
  output route, and audible success are not included.

Use finite safety bounds, not game policy:

- MAX_AUDIO_EVENTS_PER_BOUNDARY = 256, covering accepted play and stop events
  in one load, tick, or reload boundary.
- MAX_ACTIVE_AUDIO_LOOPS = 256.

Calls beyond a bound fail with a deterministic diagnostic and do not append
unbounded state. The first Web host should also use a finite live voice ceiling
of 256 and report a dropped one-shot when the ceiling is reached. These bounds
are implementation safety limits, not categories or prioritization rules.

### 3.4 Deterministic intent versus device time

| Deterministic core fact | Nondeterministic host fact |
| --- | --- |
| Handle allocation and call order | AudioContext.currentTime |
| Asset id, volume, and loop flag | Decoder latency and actual start latency |
| started_frame and fixed simulation frame | Decoded duration, clock drift, and device suspension |
| Active loop desired set | Output device, browser permission, route, and audible result |
| Stop intent | The exact instant a source stops at the hardware |

Replay and digest comparison use only the left column. Game.update does not
receive currentTime, duration, ended callbacks, or a promise that a voice was
heard. A game that needs gameplay sequencing uses fixed-frame logic or its own
timer. The host starts a late intent now; it does not subtract elapsed device
time from the requested playback position.

### 3.5 Natural one-shot completion

The Web host owns a map of currently allocated voices only while a browser
source exists. For a non-looping play event it:

1. Resolves and decodes the verified asset bytes.
2. Creates an AudioBufferSourceNode and a GainNode.
3. Sets the gain from volume, sets loop=false, connects the nodes, and starts
   at the current host time.
4. Registers an idempotent ended handler that disconnects and removes the
   handle from the host map.

The ended handler produces host feedback only. It does not call back into
Luau, alter the world, or append a completed intent. stop looks up the handle,
requests source.stop when present, and runs the same idempotent cleanup. If the
handle is absent because the voice already ended, stop succeeds as a harmless
host no-op.

There is no durable queue for one-shots. If a one-shot arrives while autoplay
is blocked, decoding is unavailable, the asset is not ready, or the host voice
ceiling is full, the host drops it and reports the reason. A later user gesture
does not replay it. A loop is different: active_loops retains its desired
state, so the host may start it after unlock or after decoding completes.

This distinction gives naturally completed one-shots without an unbounded
intent queue and without making device timing part of deterministic gameplay.

## 4. Validated asset and bundle path

The first supported declaration is a single primary audio file:

~~~json
{
  "version": 1,
  "assets": [
    {
      "id": "asset://audio/ui/click",
      "source": "assets/audio/ui/click.wav",
      "kind": "audio",
      "bundle": "content",
      "files": []
    }
  ]
}
~~~

The implementation must extend the current asset validator and packer to
recognize kind audio. It must retain all existing checks: stable asset id,
safe project-relative source and companion paths, non-empty safe bundle id,
unique declarations, manifest version validation, and per-entry archive
hashes. The source is packaged in the logical bundle path
bundles/content.bundle. On Web, the physical active generation is stored in
the existing IndexedDB bundle store, but the host must still use the verified
archive entry rather than a direct source URL.

The intended future authoring flow is:

1. Create the actual file at assets/audio/ui/click.wav.
2. Declare it with asset init using kind audio and bundle content.
3. Run bundle pack.
4. Run asset inspect --strict.
5. Run bundle install --all.
6. Install the generation in the Web runner and call readActiveAsset for the
   declared id.
7. Verify archive magic, version, path, range, and SHA-256 before decoding.

Dynamic asset ids inside Luau are not statically proven by the current strict
inspection scope. At runtime, an id that is missing, undeclared, from another
generation, or whose bytes fail verification must fail closed with the
repository asset diagnostics such as ASSET_ID_NOT_DECLARED,
BUNDLE_GENERATION_MISMATCH, ASSET_ARCHIVE_INVALID, or
ASSET_CONTENT_CORRUPT. The host must not fall back to the project source file
for a packaged audio request.

Audio decoding remains a host operation. The core only validates the manifest
declaration and receives no bytes, Blob, decoder object, duration, or MIME
guess. Companion files may be added later if a selected codec needs them; the
first fixture should not require them.

## 5. Web-first host contract

### 5.1 Playback adapter

The first actual adapter belongs in the generic web/runner host. Its input is
the ordered audio events and active_loops from the latest successful runtime
boundary. Its local state is generation-scoped decoded buffers plus currently
live voices and loop reconciliation state.

For a verified audio asset, the adapter decodes an ArrayBuffer using the
browser Web Audio API. Each voice has one source node and one gain node. The
adapter applies volume and loop exactly as specified; it does not add a mixer
or category layer. Decoded buffers may be cached only by active bundle
generation and asset id.

If the active generation changes, the adapter invalidates generation-scoped
decoded buffers, stops and clears old voices, cancels pending decode work, and
reconciles loops from the new snapshot. It does not replay old one-shot events.

The static web/host snapshot bridge is excluded from playback acceptance. The
web/live project is useful for ABI and snapshot checks, but it is not the
generic actual-playback target.

### 5.2 Autoplay and blocked feedback

The host must not call AudioContext.resume at page load and must not label an
accepted core intent as played. The first page interaction that is allowed by
the browser, such as an explicit Enable audio button or a game pointer/keyboard
gesture, calls resume from that user-gesture handler.

The host-owned report should have a stable shape equivalent to:

~~~json
{
  "audio": {
    "scope": "web_audio_output",
    "state": "blocked",
    "reason": "autoplay_blocked",
    "message": "Interact with the game to enable audio.",
    "last_event": {
      "handle": "audio-1",
      "asset": "asset://audio/ui/click",
      "result": "dropped"
    }
  }
}
~~~

Proposed state values are uninitialized, ready, blocked, suspended,
unavailable, and failed. Proposed event results are started, stopped, ended,
dropped, decode_failed, blocked, and unavailable. The final wire location and
field names remain the open decision listed above.

The report is host UI/diagnostic output. It is not part of WorldSnapshot, the
observation digest, save data, replay input, or Luau API state. All new public
host messages and UI text in this English-only engine slice use English.

Required blocked behavior:

- Simulation and rendering continue when the context is blocked or suspended.
- A blocked one-shot is dropped once with AUDIO_AUTOPLAY_BLOCKED feedback.
- A desired loop remains in active_loops and may start after a successful
  gesture; it is not replayed from an old one-shot event.
- If resume rejects or the context remains suspended, report the failure and
  leave the deterministic runtime running.
- When the context later becomes ready, reconcile active_loops but do not
  invent or replay one-shots that were already emitted.

### 5.3 Reset, reload, and failed reload

Full project load or reset creates a new core session. The Web host must:

- stop and disconnect every live source and gain node;
- cancel pending decodes and clear generation-scoped buffers;
- discard host handles and host status tied to the old session;
- create the new runtime, then process only its initial snapshot.

The new core session starts its handle counter at audio-1. No old playback is
allowed to survive a full reset, even if the new project uses the same asset
id.

Script hot reload is different. The current runtime preserves Rust-owned world
state and does not call Game.start again. The audio contract therefore says:

- preserve active loop handles when the reload succeeds and the system remains
  enabled;
- process only audio events generated by onReload and the new script boundary;
- do not replay earlier one-shot events;
- do not seek an existing voice using started_frame;
- reconcile active_loops after reload, so a loop removed by script is stopped;
- if reload fails, retain the previous script, deterministic audio state, and
  host voices atomically.

The last point requires implementation staging or rollback around reload. A
failed reload must not leave a newly emitted audio event or a partially
changed host state. This is a contract requirement, not an assertion that the
current reload implementation already provides it.

When bundle activation succeeds, treat it as a generation boundary: reset
generation-scoped Web audio state, then consume the new successful snapshot.
One-shots emitted before activation are never replayed. If the browser tab
itself reloads, the normal full-session reset rules apply.

## 6. Implementation stages and honest evidence

| Stage | Work | Required evidence | What it does not prove |
| --- | --- | --- | --- |
| W0: shared core | Add the audio system, API/types, deterministic handles, bounded events, active loop state, asset kind validation, and Web ABI snapshot transport | Repeated same-seed/input runs have identical audio snapshots and digests; invalid arguments, bounds, disabled calls, reset, and reload behavior are covered | No audible output; a snapshot is not playback |
| W1: Web asset adapter | Use the active generation reader, verify kind and hashes, decode the selected first-slice format, scope buffers by generation, and expose host status | Missing/corrupt/mismatched bundle entries fail closed; decoded bytes are from the active verified archive | Does not prove a browser allowed output |
| W2: Web actual playback | Wire web/runner to Web Audio API, gesture unlock, play/stop, gain, loop reconciliation, natural ended cleanup, voice ceiling, reset, bundle generation reset, and blocked feedback | In a real browser with a packaged fixture and user gesture: a one-shot starts and ends, a loop persists and stops, volume is applied, and blocked output is reported honestly | Does not prove native desktop or Android playback |
| D1: native later | Select a decoder and output backend for the native preview and add host evidence | A future native host test that actually reaches an output device | Not required for this work package |
| D2: Android later | Select an Android decoder/output API and extend the mobile lifecycle/ABI boundary | A future APK/device or emulator playback test | Not required for this work package |

The W2 acceptance page must use the generic Web runner with a packaged,
verified bundle. It must not use a hand-authored source URL, a static snapshot,
or a test that only sees an audio event in JSON. A browser-side node/state
trace plus a manual audible check is playback evidence; a WorldSnapshot or
digest alone is not.

The current Web smoke path has no audio implementation. The current native and
Android paths have no audio implementation. That is the honest baseline.

## 7. Verification matrix

Before implementation is considered complete, independently reviewable checks
should cover:

| Check | Expected result |
| --- | --- |
| Same seed and input replay | Same handles, events, active_loops, started_frame values, and observation digest |
| Repeated observation without a tick | Same transient events, with no duplicate host playback |
| One-shot natural end | Host removes the voice on ended; core does not gain a completed entry |
| Loop | One play event, persistent active_loops entry, and a stop event/removal |
| Stop after natural end | Idempotent no-op with no core or host error |
| Invalid asset id or volume | Deterministic engine diagnostic and no intent |
| Event or loop bound | Deterministic rejection without unbounded memory |
| Disabled system | Stable api.audio table and SYSTEM_DISABLED for both calls |
| Active bundle path | Only a declared audio kind and verified active archive bytes can reach decode |
| Corrupt or stale bundle | Fail closed with asset/bundle diagnostic; no source fallback |
| Autoplay blocked | Runtime keeps ticking; one-shot is dropped; explicit English blocked feedback is shown |
| Gesture unlock | Context becomes ready if permitted; desired loops reconcile; old one-shots are not replayed |
| Full reset | Old voices, pending decodes, buffers, and handles are cleared |
| Successful script reload | Existing loops reconcile; only reload-boundary events are consumed |
| Failed script reload | Previous runtime and audio output remain intact |
| Browser playback evidence | Web Audio source/gain lifecycle and actual browser output are observed; snapshot is treated only as intent evidence |

## 8. Existing dependency and toolchain check

The workspace currently has no direct audio crates or JavaScript audio
adapter. Cargo.lock has no identified rodio, cpal, symphonia, lewton, hound,
Ogg/Vorbis, or equivalent audio implementation. The Web-first slice therefore
does not need a Rust audio dependency: the first host can use the browser Web
Audio API after verified bytes are supplied by the existing bundle store.

The checked local toolchain is Rust 1.95.0 with the configured
wasm32-unknown-unknown, wasm32-unknown-emscripten, aarch64-linux-android, and
x86_64-linux-android targets. node and Python are available. emcc is not on
PATH, although the repository points to a Unity Emscripten installation that
contains the compiler. No build was run for this design task.

Android SDK/NDK directories are present, but no device or emulator is
connected. gradle, aapt2, d8, apksigner, and xcodebuild are not available on
PATH. These facts are recorded for capability honesty only; none is a
Web-first acceptance requirement or blocker.

## 9. Implementation touchpoints, not changes in this work package

The eventual implementation will likely touch the engine system and world
state, runtime/API bindings, both canonical Luau type files, asset validation
and CLI declaration help, the Web ABI payload, and web/runner playback/UI.
The asset workflow and platform capability documentation will need the
audio-kind and Web-evidence updates at that time.

This work package intentionally changes none of those implementation files.
It owns only this design document. No code, build artifact, branch, or commit
is part of the requested slice.
