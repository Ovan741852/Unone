# Unone Blender plugin

This is an optional AI-facing plugin. It is not part of the Rust runtime and
does not make Blender a required dependency.

The plugin speaks `unone.plugin.v1` over one JSON request and one JSON result
line. It can self-test without Blender installed, inspect Blender availability,
validate a scene sketch, and stage canonical `scene.json` data for Unone.

The intended production extension is to add Blender's Python/glTF export behind
the same tools. The engine only consumes the staged canonical scene and keeps
the runtime independent from Blender.
