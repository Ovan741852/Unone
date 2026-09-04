# Decision 0009：pointer 以 world-space snapshot 進入遊戲層

## Context

Angry Birds 需要拖曳與放開；iOS、Android、Web、native 的 pointer event、螢幕像素、device scale 與多點觸控細節不同。若讓 Luau 直接讀平台座標，遊戲規則會被平台污染，也難以 deterministic replay。

## Decision

- platform adapter 將主要 pointer／觸控轉成 engine world space。
- Luau 只讀 `input.getPointerPosition()` 與 `input.isPointerDown()`。
- headless `InputFrame` 用 `actions` 與可選的 `{ position, down }` 表達同一份 snapshot。
- 未提供 frame 會清空 action 與 pointer down；pointer position 保留最後座標但不再表示按下，避免 sticky input。
- 多點觸控、gesture、滑鼠按鍵差異留在 platform adapter；需要遊戲語意時由遊戲端使用 named action。

## Consequence

拖曳玩法可用同一份 sequence 在 native、Web 與 headless replay；引擎不需要知道 Angry Birds 的 sling 規則。未來若驗證遊戲需要多指手勢，先在 adapter 增加明確的 semantic action 或額外 snapshot schema，不把原始 platform event 直接暴露給 Luau。
