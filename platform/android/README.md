# Unone Android host smoke

這是第一個可安裝的 Android host smoke，不是把 Android API 加進 `unone-engine`。

- Java `Activity/View` 負責 APK、Canvas 顯示、觸控事件、surface resize 與 pause/resume。
- `unone_android_host.c` 只做 JNI glue，呼叫既有 `unone-mobile-ffi` C ABI。
- Rust engine/FFI 負責 Luau、fixed tick、world、semantic observation 與 lifecycle contract。
- build script 將指定遊戲的 `project.unone.json`、entry script、scene 放入 APK assets；預設使用 Angry Birds 2D capability smoke。

Windows 沒有 Gradle 依賴；script 使用已安裝的 Android SDK build-tools、JDK、NDK 與 Rust Android target 組出 debug-signed APK：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/build-android-apk.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/run-android-apk-smoke.ps1
```

指定其他遊戲：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/build-android-apk.ps1 `
  -ProjectRoot D:/Projects/Unone_Games/3d-racing
```

這個 host 的 Canvas renderer 只提供 smoke 可視化，不是 production renderer、asset decoder、CDN、bundle downloader 或最終 Android game host。下一步要用同一套 host 接上 bundle fetch/cache/generation、真實 asset pipeline、safe-area insets 與可重播的 game-specific mobile evidence；iOS 仍需 macOS/Xcode host。
