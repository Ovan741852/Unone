# Android APK host smoke

日期：2026-09-05

## 目的

把既有 `unone-mobile-ffi` headless contract 推到真正可安裝的 Android package，確認 platform host 的責任沒有只停留在 Rust binary。Java Activity/View 與 JNI glue 留在 `platform/android/`；Rust engine 仍只負責 Luau、fixed tick、world、semantic observation 與 FFI lifecycle。

## 實作

- `platform/android/UnoneActivity` 讀取 APK assets 內的 project/script/scene payload。
- Android Canvas 依 `WorldSnapshot` 畫出 Angry Birds 2D capability smoke 的 bird/pig/block；這是 host smoke renderer，不是 production renderer。
- touch 由 Android pixel 座標轉成 world/UI logical pointer，再經 `unone-mobile-ffi` 送入同一個 Luau runtime。
- `singleTask` 保持單一遊戲 Activity/session，避免 adb 回到 app 時建立第二個 runtime。
- build script 使用 Android SDK build-tools、JDK、NDK 與 Rust target，不要求 Gradle；debug keystore 固定在 build directory 外，支援 `adb install -r`。

## 驗證

在 API 34 `Pixel_8` x86_64 emulator（`emulator-5554`）通過：

```text
build-android-apk.ps1: APK signed and apksigner v2/v3 verified
run-android-apk-smoke.ps1: install -r, foreground Activity, live process, UI dump
                           project_loaded, runtime_paused, runtime_resumed, no fatal log
visual smoke: frame=720, bird/pig/block visible
touch smoke: emulator swipe kept Activity/process alive and updated world view
```

截圖：[android-apk-host.png](D:/Projects/Unone/docs/devlog/2026-09-05-android-apk-host.png)；觸控後截圖：[android-apk-host-touch.png](D:/Projects/Unone/docs/devlog/2026-09-05-android-apk-host-touch.png)。

## 中途問題

- PowerShell 深度序列化 payload 曾造成記憶體異常成長，改為保留 scene source JSON；見 `docs/issues/2026-09-05-android-apk-powershell-payload-memory.md`。
- JNI header、DT_NEEDED 絕對路徑、debug signature、前景檢查、Activity instance 與 PowerShell `$PID` 問題都已分別修正並記錄於 `docs/issues/2026-09-05-android-apk-jni-header.md`、`docs/issues/2026-09-05-android-apk-signature.md` 與 `docs/issues/2026-09-05-android-apk-lifecycle-smoke.md`。

依既定流程執行 Claude CLI `2.1.260` 第 26 次 read-only review；約 60 秒沒有 stdout/stderr，Ctrl+C 中止，故不算 review 通過。詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-26.md`。

## 邊界

這只證明最小 Android package/host/lifecycle/input 的可運作邊界；尚未證明 production GPU renderer、真實 asset decoder、bundle download/cache/update、release signing、Android 七款遊戲 smoke 或 iOS host。矩陣的七個 final gate 維持 `0/7`。
