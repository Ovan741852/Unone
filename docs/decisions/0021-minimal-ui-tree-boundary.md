# Decision 0021: UI is a minimal game-composed tree, not an engine UI framework

日期：2026-09-05  
狀態：accepted（AVG validation slice；實際 host renderer pending）

## Context

MVVM 需要一個跨 Web/native 的 View 出口，但把 ViewModel、layout、widget、事件路由或 UI binding 放進引擎會讓引擎開始擁有遊戲業務。AVG 的實際切片也證明，遊戲端需要把 typed ViewModel 組合成可渲染的畫面，並使用與 world pointer 分離的 logical UI 座標。

## Decision

引擎只提供一個必要的 presentation transport primitive：

- `api.ui.setRoot(root)` 接受一個 `screen` root。
- root 只有 `id`、目前遊戲節點 `node` 與 `children`。
- child 支援 `text`、`button`、`image` 與可遞迴的 `component`；各自都有 `id`、`rect`，button 另有非空 `action`，image 以穩定 asset ID 加 `fit` 指向 texture/SVG。
- `rect` 使用遊戲／host 約定的 logical design space；host 負責 viewport、pixel、DPI、safe area 與實際 Web/native draw。
- 引擎驗證 schema、有限數量、唯一 id、有限數字與正尺寸，然後把 typed tree 放進 `WorldSnapshot.ui`。
- Core 目前限制一個 screen 最多 256 個節點（包含 component wrapper），最多 16 層 component wrapper；Lua 的 portable JSON boundary 保留更高的 64 層 guard，讓 Core 能回傳精確的 UI 錯誤而不是先被通用序列化層截斷。
- `input.getScreenPointerPosition()` 回傳 host 已正規化到同一 logical design space 的 pointer；`getPointerPosition()` 仍然只代表 world space。
- test manifest 可以用 `ui.equals` assertion 驗證 typed tree；數值先經同一 validator，避免 `10` 與 `10.0` 的 JSON 表現差異造成假失敗。

## Ownership

```text
Game Model / rules                 → Luau game
Typed ViewModel                    → Luau game
View composition / text / action   → Luau game
UI schema validation / snapshot    → engine
pixel / DPI / safe area / draw     → Web/native host
```

`action` 只是遊戲端語意字串；引擎不執行 action、不做 command registry、不做 hit-test、不做 layout、不做 styling、不做 font、widget、focus、binding、animation 或 UI event bus。`component` 只保留可驗證的 reusable 結構，不執行模板註冊、MVVM binding 或隱式排版。遊戲可以依自己的規則對 screen pointer 做 hit-test，再轉成 semantic action。

## Consequences

- AVG 可以保留 strict typed ViewModel，並以一個明確 `:: any` 邊界發布 View tree。
- 同一份 game-owned View tree 能被 headless test、AI、Web host 與 native host 讀取。
- 需要更大 UI 能力時，先取得至少三個驗證遊戲的共同阻塞，再提煉 schema；不因「像一般引擎」而預建完整 UI framework。
