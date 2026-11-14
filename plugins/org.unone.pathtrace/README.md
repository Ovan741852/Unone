# Unone Path Trace

Path-traced stills of a project's 3D scene: soft shadows, mirror and blurred
reflections, sky light from an HDR environment. Good for store pages, trailer
frames and checking lighting. It is an offline tool, not a game renderer: it
reads the scene file and its assets and writes a PNG.

```powershell
game --project <game> plugin call --id org.unone.pathtrace --tool pathtrace.render --input request.json
```

with `request.json` such as `{"width": 1280, "height": 720, "samples": 128}`.

| Input | Default | Meaning |
|---|---|---|
| `scene` | `main_scene` | scene file to render |
| `output` | `renders/still.png` | PNG to write |
| `width`, `height` | 320 x 200 | up to 4096 |
| `samples` | 16 | rays per pixel; more is smoother and slower |
| `bounces` | 3 | indirect bounces |
| `exposure` | 1 | multiplies the result before sRGB |
| `seed` | 1 | the same seed gives the same image |

It uses the same conventions as the official players:
[materials](../../docs/materials.md) (diffuse plus GGX highlights, emissive),
[lighting](../../docs/lighting.md) with intensity 1 as full light (sun and
point lights with shadow rays; ambient, hemisphere and the HDR environment as
the sky), primitive meshes, static mesh assets with PNG textures, and the
scene camera. Entities are taken as the scene file declares them: runtime
spawns and `api.lighting` changes are not included. JPEG textures render white
with a `PATHTRACE_TEXTURE_SKIPPED` warning.

The tracer runs on one CPU core in Node: small scenes take seconds at 320x200,
large meshes and high sample counts take minutes.

Tests: `node --test plugins/org.unone.pathtrace/test/pathtrace.test.mjs`.
