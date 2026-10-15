# ADR 0037: Official player defaults and declarative shader ownership

## Context

A game can pass Unone's headless gameplay tests while replacing the presentation
layer with its own renderer and ignoring existing engine particles. That makes
gameplay acceptance easy to mistake for evidence about the official player's
capabilities. A custom shader request also does not inherently require a new
renderer.

## Decision

AI-authored games use the official player by default. Scene `particle_effects`
and `api.particle.*` are the first path for authored particle effects. Core
validates and publishes scene shader definitions, typed uniform values and
sprite bindings; Luau selects material IDs and changes parameters through
`api.shader.*`. Shader source and effect choices are game content. GPU contexts,
compilation, material allocation, drawing and disposal belong to the engine's
presentation layer.

The initial shader interface supports GLSL fragment materials on 2D sprites in
the official WebGL renderer. Native export rejects shader declarations and
WebGPU rejects active bindings until those backends implement the contract.
Meshes, instances, particle materials and arbitrary full-screen shaders are not
part of this initial interface. Existing Bloom remains a presentation option.

Renderer replacement is an explicit trusted Web extension for a stated project
requirement: `renderer_mode: "custom"`, a `renderer_module` and an explicit
`renderer_files` inventory. It runs as ordinary host JavaScript, not a sandbox.
The default and omitted mode remain `official`, preserving existing official
exports; unmarked replacement configuration is rejected. Native targets require
the official renderer.

## Alternatives and consequences

Making every shader a renderer replacement would duplicate asset/resource
lifecycle and bypass reusable particle facilities. Prohibiting all replacement
renderers would remove a deliberate host extension point. Explicit selection
keeps that extension available without making it the ordinary game path.

Preflight validates compatibility; export and boot reports disclose renderer
selection. These checks and headless replay validate declared contracts, not GPU
execution. Visual acceptance still needs evidence from the exported player on
the stated target. Shader compilation failures and unsupported backends surface
explicit diagnostics rather than silently substituting another material.
