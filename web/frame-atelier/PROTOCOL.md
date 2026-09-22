# Frame Atelier AI-native protocol

Frame Atelier keeps the editor state as serializable data. The model does not
need to inspect a screenshot or drive the browser to make a layout decision.
The local host exposes the same shape as `window.frameAtelier`. The page polls
the local command bridge, so an agent can use the editor without reading pixels
or driving a browser.

```js
const state = window.frameAtelier.inspect();
await window.frameAtelier.command("update_frame", {
  id: "F02",
  purpose: "顯示可查看與穿戴的裝備卡片",
  rect: {x: 59, y: 20, width: 37, height: 70},
});
```

From a local agent, use the HTTP command endpoint instead:

```powershell
$session = Invoke-RestMethod http://127.0.0.1:8001/api/frame-atelier/session -Headers @{ 'X-Frame-Atelier' = '1' }
$headers = @{ Authorization = "Bearer $($session.token)" }
Invoke-RestMethod http://127.0.0.1:8001/api/frame-atelier/command -Headers $headers -Method Post -ContentType 'application/json' -Body (@{
  name = "update_frame"
  payload = @{ id = "F02"; purpose = "顯示可查看與穿戴的裝備卡片"; rect = @{ x = 59; y = 20; width = 37; height = 70 } }
} | ConvertTo-Json -Depth 8)
```

Run `python scripts/serve-frame-atelier.py` from the Unone checkout and open
`http://127.0.0.1:8001/Unone/web/frame-atelier/`. The server trusts local processes,
not arbitrary websites: it checks Host/Origin/fetch metadata, denies cross-origin
requests, and requires a per-process bearer token on every API except session
bootstrap (which requires the custom header shown above). Never log or persist
the token. Restarting the server rotates it; the page reconnects on its next poll.
This is not an account service or a LAN/remote-development server.

Only explicit prototype resources are served; no repository browsing is allowed.
The sibling `UnoneUI` checkout is required; the YesSir background image is optional.
The separate assistant on port 8787 is not started or secured by this bridge.
Commands are bounded (32 pending, 1..300 seconds) and never automatically replayed.
A timeout reports `may_have_executed`: inspect state before deciding to retry.

Available commands: `inspect`, `select_frame`, `set_profile`, `add_frame`,
`update_frame`, `analyze_frame`, `generate_interface`, `analyze_hierarchy`, `apply_suggestion`,
`apply_suggested_rect`, `keep_current_rect`, `add_subframes`, and `create_draft`.

The stable payload includes the project, active design profile, 0..100 logical
rectangles, frame purpose/status/note, asset candidates and the Unone UI tree.
The frame-first Gemma request runs as small stages: it first plans panels from a
human brief, reviews obvious geometry failures, then decomposes one approved
panel at a time. The payload is JSON and does not send a screenshot. A future
Unone plugin/Workshop adapter can call the same commands through the Developer
Protocol without using Computer Use.
