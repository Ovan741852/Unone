# Decision 0012：Sprite 尺寸是 scene contract，資產內容不進 core

- 日期：2026-09-05
- 狀態：accepted

## Context

Angry Birds 的第一個 native preview 只把每個 entity 畫成固定大小的 quad。這讓 scene 已經宣告的 sprite 與畫面不一致，也讓 AI 無法從 observation 或 scene 看出呈現尺寸。另一方面，現階段尚未有足夠證據需要在 engine core 內加入完整 texture import、atlas、材質或遊戲專用 sprite renderer。

## Decision

`SpriteData` 增加必要的 `size: Vec2` scene 欄位，預設為 `1 x 1`，且引擎在載入 scene 時要求 x、y 都是大於 0 的有限數字。native preview 依這個 contract 畫 procedural quad；真實 asset 的解析、下載、快取與美術排列仍屬後續 asset pipeline/host 工作。

尺寸屬於引擎需要理解的呈現幾何；asset URI 的語意與實際內容仍由遊戲專案決定。Rust 不辨識 bird、pig、block 等遊戲名稱，也不為單一遊戲加入 sprite 特例。

## Consequences

- 舊 scene 省略 `size` 仍可載入，使用明確的 unit-size default。
- 無效尺寸會在 scene load 階段回傳 `SCENE_SPRITE_INVALID`，而不是讓 renderer 產生不可預期的幾何。
- observation 會包含 scene 宣告的尺寸，AI 可在 headless 與 preview 間比對同一份 state。
- procedural quad 不是「真實 sprite asset 已完成」的證據；Angry Birds 仍需獨立驗證 asset、命中回饋、UI、hot update 與跨平台 host。
- 等至少兩個驗證遊戲證明共同需求後，再決定是否增加 texture/atlas 等 engine primitive。

