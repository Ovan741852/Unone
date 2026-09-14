# Unone UI Lottie capability request

Owner: Unone engine/UI task. YesSir owns asset authoring, UI specifications, and use of the supported component only. Do not implement a second private game-side player. Current inspection found no `lottie` references in either checkout's crates/docs or the game's host/UI; please confirm an existing supported component before adding one.

## Concrete use case and fixtures

Forest lord fishing roguelike needs transparent reward overlays. Authoring fixtures are in `D:/Projects/YesSir/_Games/ashen-legion/design-v1/animations/`: big-win.json, mega-win.json, legendary-win.json, coin-burst.json. All are shape-only Lottie 5.13.0, 960×540, 30fps, 120 frames. Lettering is outlined. No expressions, fonts, raster assets or network dependencies. Markers: burst 0, coins_land 36, collect 65, complete 120.

The design gallery may use the upstream lottie-web package for asset inspection; that is not evidence of Unone runtime support and must not become a custom gameplay renderer.

## Requested first version

- Registered animation asset kind/ref, copied into web export with correct JSON MIME and inventory hash.
- Supported UI component using the engine's normal layout: asset ref, position/anchor, width/height, contain scaling, z-order, visibility, opacity and pointer passthrough.
- Play once, loop, pause, resume, stop, restart, playback speed, seek by frame/marker, dispose. Source change and UI removal release old playback/resources.
- Ready / complete / error notifications with instance ID or generation so an old instance cannot complete a new animation. No completion double-fire on restart, seek or source replacement; specify seek-to-end behavior.
- Game pause pauses UI animation when requested; reduced-motion can display a specified static frame. Missing/bad/unsupported assets return actionable errors and leave gameplay functional.
- Preload all four overlays; no external CDN required by the shipped game. Document precise supported Lottie subset and renderer/backend differences. Do not claim WebGPU playback if using a DOM SVG component.
- UI inspection tools report component bounds, clipping, asset readiness, current frame, playing/paused state and errors. Capture screenshots of real component playback through Unone's own preview/export path.

API names above are requirements, not an invented engine contract. Please supply the actual documented schema/API plus a minimal example for us to consume.

## Ownership and acceptance

No reward/economy logic in player. Luau supplies already-settled events with eventId, playerId, tier, title and amount; game-level presentation chooses asset and handles event dedupe/priority. Animation completion never credits gold. World coin particles still use monster world position and actual player cannon position, not the fixture's fixed UI collection point.

Acceptance: load all four fixtures in engine preview and exported game; capture nonempty frames 0/15/40/80/110; play/seek/pause/restart/remove/source-swap; corrupt/missing JSON; reduce motion; pointer passthrough; no stale completion; clean disposal. Provide read-only smoke command and evidence, exact capability limits and a version/commit. A gallery-only upstream-player test does not satisfy runtime integration acceptance.
