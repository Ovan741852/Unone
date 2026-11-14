# Unone Render Effects

Stylized full-screen passes for the official Web player, installed as
[render extensions](../../docs/render-pipeline.md#extension-passes-web).
Built-in passes (AO, fog, bloom, tone mapping, colour grade, vignette, FXAA)
need no plugin; this adds looks a general engine does not ship by default.

| Kind | Look | Params (default) |
|---|---|---|
| `fx.crt` | Curved tube screen, scanlines, RGB mask | curvature (0.15), scanlines (0.35), mask (0.2) |
| `fx.pixelate` | Square pixel cells | size in pixels (4) |
| `fx.grain` | Film grain | amount (0.08), size (1.5), animated (true) |
| `fx.chromatic` | Red/blue fringes towards the edges | amount (0.004) |
| `fx.posterize` | Few colour levels, ordered dither | levels (6), dither (0.5) |
| `fx.ink` | Outlines on brightness edges | threshold (0.2), thickness (1), strength (1), color (#101010) |

```powershell
game --project <game> plugin call --id org.unone.render-effects --tool effects.list --input empty.json
game --project <game> plugin call --id org.unone.render-effects --tool effects.plan --input request.json
game --project <game> plugin call --id org.unone.render-effects --tool effects.apply --input request.json
```

with `request.json` such as `{"effects": ["crt", "fx.grain"]}`. `effects.apply`
copies the modules to `render/fx/`, declares them in `player.presentation.json`
`render_extensions`, and adds the passes to `project.unone.json`
`render_pipeline`, disabled unless `"enabled": true`. Game code then switches
and tunes them:

```luau
api.render.setPass("crt", {enabled = true, params = {curvature = 0.25}})
```

Out-of-range params are clamped and wrong types fall back to the default.
A module you edited is not overwritten unless you pass `"force": true`.

Extension passes run in the official Web player only; native exports reject
them (`NATIVE_RENDER_PASS_UNSUPPORTED`).

Tests: `node --test plugins/org.unone.render-effects/test/render-effects.test.mjs`.
