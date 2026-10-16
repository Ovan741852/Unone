# Game authoring contract

Use Unone's official player and renderer by default. Keep gameplay in Luau and use engine APIs for presentation. Do not obtain a WebGL/OpenGL context or write a separate browser host for an ordinary game.

Before adding effects, run `game api search particle`, `game api describe particle.play`, `game api search shader`, and `game systems list --json`. Author scene `particle_effects` for explosions, thrusters, sparks, smoke, trails and auras. Keep the particle system enabled when using these effects. Custom shaders go through scene `shader_materials` and `api.shader.*`; the engine owns GPU compilation and rendering. Use presentation Bloom when appropriate.

`player.presentation.json` selects `renderer_mode: official`. Replace the renderer only as an explicitly selected extension for a stated project requirement, never merely to add effects or shaders: select `renderer_mode: custom`, set `renderer_module`, and list the entry plus local dependencies in `renderer_files`. This trusted Web extension is not a sandbox and does not claim official renderer coverage. Report the selected mode in validation.

Run verify for the scaffold, then `game project preflight --target web` and `game project prepare --target web --output <new-output-directory>` to obtain an official player export and launch descriptor. Inspect SDK availability if preflight reports a missing runtime. The starter tests only check onboarding and movement; add game-specific acceptance and inspect rendered output before delivery.
