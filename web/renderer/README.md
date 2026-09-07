# Unone renderer boundary

The Rust/Luau runtime publishes a `WorldSnapshot`; it does not know about
Three.js, WebGPU, WebGL, DOM, or browser APIs. A host selects a renderer
adapter implementing:

```text
draw(snapshot)
clearTextures()
```

The generic runner defaults to `renderer=three`. Three.js uses its WebGPU
backend when the browser can initialize one and falls back to WebGL otherwise.
Both paths upload declared SVG/PNG/JPG/WebP sprites as GPU textures. The
diagnostic `renderer=webgpu-raw` adapter remains available for testing the
engine's direct WebGPU path.

The URL can override the bundled module for an application build:

```text
?renderer=three&three=/assets/three.module.js
```

