# Decision 0014：Host 以 `tick_with_input` 驅動共同 runtime

- 日期：2026-09-05
- 狀態：accepted

## Context

native preview 已有滑鼠/鍵盤 adapter，headless runner 已有 `InputFrame` sequence，browser host 也需要把 pointer event 轉成同一種語意資料。若每個平台自行決定「何時套 input、何時 tick、缺少 pointer frame 是否 sticky」，同一份 Luau 會在不同 host 得到不同結果。

## Decision

`EngineRuntime::tick_with_input(&InputFrame)` 是 host-to-engine 的單 frame boundary：

- host 先把平台座標／按鍵正規化成 `InputFrame`；
- engine 在 tick 前替換 action snapshot；
- 有 pointer frame 時更新 position 與 down；沒有 pointer frame 時只清除 down，position 保留；
- engine 執行一次固定 timestep，回傳該 frame 完成後的 `WorldSnapshot`。

`run_with_input_sequence` 改用同一個入口。平台 adapter、瀏覽器事件、測試 fixture 與 Luau 遊戲規則不進這個方法。

JSON InputFrame 的 pointer position 使用共用 Vec2 closed wire contract，只接受
x/y；多餘 vector 欄位會被拒絕，而非悄悄忽略。這不修改 numeric pointer FFI
參數、action 語意或 opaque game/save data，也不是替 Luau table 做全域驗證。

## Consequences

- native、Web、iOS、Android 與 headless replay 的 input/tick 順序有單一來源。
- input normalization 與裝置政策仍留在 host；engine 不知道滑鼠、觸控、鍵盤或 device scale。
- 缺少 pointer frame 不會讓按下狀態 sticky，避免 hot reload 或 sequence 邊界留下幽靈輸入。
- `tick_with_input` 是必要的 runtime contract，不是額外的 input abstraction；若未來 host 有不同需求，先以可重播測試證明，再調整此 boundary。
