# Issue：目前 Windows 開發環境尚不能完成 iOS/Android host smoke

- 日期：2026-09-05
- 範圍：iOS/Android platform host build
- 分類：Environment / platform validation
- 狀態：已記錄，非 engine logic blocker

## 盤點結果

- Rust installed targets：`x86_64-pc-windows-msvc`、`wasm32-unknown-unknown`、`wasm32-unknown-emscripten`；尚未安裝 Android/iOS Rust target。
- Android SDK 與 `adb.exe` 存在，但本機未找到 `gradle`；因此目前只能做 SDK/device 可見性盤點，不能宣稱 Android host package/build 通過。
- `xcodebuild` 不存在；Windows 不能直接完成 Apple SDK、codesign、simulator 或 device smoke。

## 判斷

這是 host toolchain / 實機驗證問題，不是把 iOS/Android 依賴塞進 engine core 的理由。engine 先維持 platform-neutral Rust runtime，mobile host 依 `docs/decisions/0017-mobile-host-lifecycle-boundary.md` 在具備對應工具鏈的環境實作。

## 解鎖條件

Android：固定 NDK、Gradle/AGP、Rust Android targets 與 emulator/device matrix，完成 pause/resume、surface recreate、touch、bundle cache/update 與 packaged APK smoke。iOS：在 macOS 固定 Xcode/SDK、Rust target、signing 與 simulator/device matrix，完成同等 lifecycle/cache smoke。兩邊都要對照 headless replay observation，而不是只看畫面成功啟動。
