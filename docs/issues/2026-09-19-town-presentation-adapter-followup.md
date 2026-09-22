# Town presentation adapter: engine follow-up

Scope: reusable engine capabilities, not Wuxia gameplay. All business simulation stays in Luau.

## Evidence / current workaround

`_Games/wuxia-sandbox/viewer` now reuses `web/renderer/three.js` with 146 entities / 36 asset entries, actual CC0 OBJ-derived meshes and palette textures. A small loopback bridge samples the same native runtime. Gameplay is not reimplemented in JS. Native CLI preview still explicitly logs that it uses deterministic silhouettes.

1. **Host parity**: make normal `game preview` render the same mesh/UV and semantic UI as the full player, or explicitly route to a supported full renderer. A page containing only native tools is not a game preview. Do not label silhouette loading success as successful model rendering.
2. **World labels**: accept entity anchor + pixel offset + semantic text + UI action, with projection, offscreen handling and hit testing. Current game anchors 40 DOM labels to 3D NPC positions, supports selected route line and details, and keeps short leader lines when labels would overlap.
3. **Typed empty sequences**: native Luau observations encode empty tables as `{}`. The game hit `thinking_candidates.map is not a function` when inspecting a dead NPC; array normalization fixes it locally. Provide a declared observation schema or explicit sequence wrapper instead of depending on consumer guesses.
4. **Automated visual verification**: existing native screenshot API is useful, but it captures the silhouette host and excludes UI. Full supported host should expose a fresh frame PNG with optional UI and projection metadata. Browser screenshots are presently required to test the game presentation, not to inspect native memory.
5. **Presentation transport**: expose bounded transform deltas / presentation snapshots, with timestamps and documented interpolation. This game samples full native snapshot at ~10 Hz and interpolates transforms at capped ~60 FPS; a reusable route would remove the per-game bridge.

Validation: town Luau type check passed; verify 4/4, scenario tests 3/3. Seeded replays at 1/120/600/1200/2400/4800/7200 frames passed sampled movement / spacing / four-direction route / building-footprint checks. Latest p95 ~1.1–3.1 ms; one sampled run had one frame over 16.667 ms, so no claim of zero spikes. Browser screenshot visibly shows mesh geometry/textures, names/actions, selected character portrait and intent detail.

This issue file is the handoff record in the Unone project. No live cross-thread delivery/acknowledgment is claimed.
