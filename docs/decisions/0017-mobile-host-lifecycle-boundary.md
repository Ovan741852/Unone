# Decision 0017：Mobile lifecycle 由 host 驅動，engine 維持可重播 runtime

- 日期：2026-09-05
- 狀態：accepted（host contract；實機 smoke pending）

## Context

iOS 與 Android 會暫停、恢復、重建 surface、改變 safe area、切換觸控狀態與限制背景執行；這些不是遊戲規則，也不能直接放進 `unone-engine`。另一方面，若兩個 mobile host 各自維護一套 frame/input semantics，native、Web 與 headless replay 會再次分叉。

## Decision

mobile host 只提供 platform adapter，使用與 Web/native 相同的 engine boundary：

- host 負責 app lifecycle、window/surface、safe area、device scale、touch normalization、platform storage、permission、audio device 與 package/update policy。
- engine 負責 `EngineRuntime`、fixed-step simulation、world state、Luau、semantic diagnostics、bundle integrity primitive 與 `tick_with_input`。
- 每次 host frame 先送已正規化的 `InputFrame`，再呼叫一個 fixed tick；pause 時停止送 tick，但不偷偷改變 simulation time。resume 時由 host 選擇丟棄過期 wall-clock 或按明確的 catch-up budget 重播，不把不受控的 elapsed time 傳進遊戲規則。
- surface recreate 只重建 renderer/resource binding，不能重建遊戲 session；bundle generation 只有在 safe point 成功驗證後才 apply，失敗保留上一代。
- 第一版 mobile FFI 只需要 `init/load`, `set_surface_or_resize`, `set_input_frame`, `tick`, `observe`, `pause/resume` 的窄 adapter；不把 UIKit、Android View、JNI、Objective-C object 或 GPU handle 暴露給 Luau。

## Acceptance

同一份 Luau scene 至少要通過：冷啟動、pause/resume、surface recreation、旋轉/safe-area resize、觸控 pointer normalization、cache-only bundle load、失敗 hot update 保留上一代，以及 headless replay digest 對照。沒有 iOS/Android 實機或 emulator 證據時，只能標記 contract drafted，不能標記平台完成。

## Consequences

不為 mobile 建立第二套遊戲 API；host 差異集中在 adapter。真正遇到 audio、background fetch、push 或 OS-specific permission 時，才增加 host capability，不在 engine core 預先塞入平台服務。
