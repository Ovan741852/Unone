# Android mobile host smoke

日期：2026-09-05

本輪新增開發驗證層 `crates/unone-mobile-android-smoke`，不進 engine core，也不包含任何遊戲規則。`scripts/run-android-mobile-smoke.ps1` 會用 Android NDK 對應 target linker 編譯 binary，部署 NDK 的 `libc++_shared.so`，再透過 adb 在 emulator 執行。

API 34 x86_64 `Pixel_8` AVD（`emulator-5554`）實際通過：初始化、載入 in-memory Luau project、resize/safe-area、semantic `InputFrame`、固定 tick、pause 時 frame 不變、surface lost/recreate、resume 只前進一個 tick，以及 Luau reload 後下一 tick 使用新 source。輸出摘要：`initial_frame=0`、`advanced_frame=1`、`paused_event=tick_skipped`、`resumed_frame=2`、`reloaded_event=script_reloaded`、`semantic_state=reloaded_advanced`。

中途先遇到 `cc not found` 與 `libc++_shared.so not found`，已分別記錄並修正 linker/runtime 部署；另修正 harness 對 reload 會自動呼叫 `Game.start` 的錯誤假設。細節見 `docs/issues/2026-09-05-android-smoke-linker.md` 與 `docs/issues/2026-09-05-mobile-reload-start-semantics.md`。

這是 Android headless FFI/runtime host smoke，不是 APK、Android UI/GPU renderer、實際七款遊戲 bundle 或 production lifecycle 通過。Windows 沒有 `xcodebuild`，iOS host 仍待 macOS/Xcode 環境。
