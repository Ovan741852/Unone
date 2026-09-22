# Frame Atelier

Frame Atelier is the first interaction prototype for the layout / GDD tool,
using YesSir / Forest Lord as its desktop-game test case.
From the Unone checkout, start the restricted local prototype server:

```powershell
python scripts/serve-frame-atelier.py
```

Open `http://127.0.0.1:8001/Unone/web/frame-atelier/`. It requires a sibling
UnoneUI checkout. Do not serve the whole projects directory or expose this
loopback prototype over the network. See the protocol for authenticated API use.

The semantic screen is also represented by `scripts/main.luau` so the project
can be checked with Unone's UI contract. The editor host owns text input,
pointer-drawn rectangles and visual styling; Gemma 3 is called through the
local assistant service on port `8787` when it is running. Desktop uses the
fixed 1920×1080 design profile, while the same frame state can be previewed as
390×844 Mobile with profile-specific logical rectangles.

The AI-native state/command boundary is documented in
`web/frame-atelier/PROTOCOL.md`. It sends semantic JSON, not screenshots.
