# @unone/sdk

Small TypeScript/Node entry point for the Unone engine. It wraps the existing
JSON CLI, so project creation and the first development loop do not require the
author to remember the Rust command shape.

From an engine checkout, the working CLI loop is:

```powershell
node packages/unone-sdk/bin/unone.mjs init C:/Games/my-game --name "My Game"
node packages/unone-sdk/bin/unone.mjs verify C:/Games/my-game
node packages/unone-sdk/bin/unone.mjs run C:/Games/my-game --frames 60 --action Right
node packages/unone-sdk/bin/unone.mjs test C:/Games/my-game
```

```ts
import { createGame, openGame } from "@unone/sdk";

await createGame({ dir: "./my-game", name: "My Game" });
const game = openGame({ projectDir: "./my-game" });
await game.verify();
await game.run({ frames: 60, action: "Right" });
await game.pluginTest("org.unone.blender");
```

The SDK is an authoring/host layer. Luau remains the game rules runtime and
Rust remains authoritative for simulation.

Optional tools are discovered through the same engine protocol. The Blender
bridge is dependency-free for its self-test, so an AI can decide whether it is
available before asking it to stage scene data. Plugin calls return the normal
structured `EngineResult` instead of throwing away diagnostics.

The current prototype resolves `target/debug/game.exe` from the checkout and
automatically forwards the pinned Luau analyzer when it is present. A future
published package can place a platform-specific engine binary in `bin/` or set
`UNONE_GAME`; no game code needs to change.
