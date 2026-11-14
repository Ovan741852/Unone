# Find before you build

`game find "<need>"` looks for something that already meets a need before an
author, human or AI, writes new code. Use plain words in any language.

```powershell
game find "distance fog"
game find "雙指縮放" --json
game find "crt scanlines" --offline --limit 3
```

MCP: `unone_find` with `need`, optional `offline` (default false) and `limit`
(candidates per source, 1 to 20, default 5).

## What it searches

Sources appear in this order, which is also the order to prefer them:

| Source | What | Next step it names |
|---|---|---|
| `engine_api` | The public engine API (`game api search`), for the whole need and for each word | `game api describe <name>` |
| `render_pass` | Built-in render passes: AO, fog, bloom, tone mapping, colour grade, vignette, FXAA ([render pipeline](render-pipeline.md)) | Declare the pass, tune it with `api.render.setPass` |
| `system` | Engine systems (`game systems search`) | `game systems list` |
| `package` | Official runtime packages bundled with the engine, such as `@unone/ui` and `@unone/gestures` | Declare `runtime_packages`, `game api describe <api>.info` |
| `plugin` | Local plugins (`game plugin list` roots): id, name, description, capabilities, tools and `keywords` | `game plugin inspect --id <id>` |
| `marketplace` | The Koncrate plugin catalogue (below) | `plugins.inspect` through the Koncrate Viewer |

Nothing is installed, enabled, called or bought. Every candidate carries
`confidence`: `strong` when the whole need, a keyword, or every word of the need
matched, `weak` when only some words did. When every candidate is weak,
`FIND_WEAK_ONLY` says so; when nothing matched, `FIND_EMPTY` does. Then writing
new code is reasonable. Say what you searched and why you rejected the
candidates.

`value.sources` reports each source's status and match count, so an empty
marketplace is never confused with an unreachable one.

## The marketplace

The Koncrate catalogue is searched through the Koncrate Viewer's local
development endpoint. The Viewer holds the user's sign-in and talks to the
store; Unone sends it only the search text, only over 127.0.0.1, and never
handles a token, cookie or password. Requests ask for Unone plugins
(`frameworks: ["unone"]`), so Koncrate entries should declare that framework.

- Start the Viewer with `--development-tools` and sign in. Unone reads the
  endpoint from `UNONE_KONCRATE_ENDPOINT`, or else from
  `%APPDATA%/Koncrate Viewer Development/development-tools.json`.
- Status `not_connected`: no Viewer answered. `auth_required`: the Viewer is not
  signed in. `unavailable`: the Viewer could not reach the catalogue. Each comes
  with `FIND_MARKETPLACE_UNREACHED` (info) and the local results.
- `--offline`, MCP `offline: true` or `UNONE_MARKETPLACE=off` skip it, keeping
  the search text on this machine.

There is no anonymous public catalogue endpoint; searching needs the Viewer.
Unone depends on the marketplace only through this optional search, so another
catalogue can replace it later.

## Making a plugin findable

Add `keywords` to `plugin.json`: words people search with when they need what
the plugin does, including other languages.

```json
"keywords": ["crt", "scanlines", "retro screen", "掃描線"]
```

Capabilities and tool descriptions are searched as well.
