# Issue：Android APK payload build 使用 PowerShell 深度序列化造成記憶體異常

日期：2026-09-05  
範圍：`scripts/build-android-apk.ps1`

## 症狀

第一次 APK build 在將 `ConvertFrom-Json` 產生的 scene object 重新以 `ConvertTo-Json -Depth 100` 組成 APK payload 時，PowerShell process 持續消耗記憶體，未進入 Rust/Java 編譯。

## 分類

這是 Windows host build tooling 的邏輯問題，不是 Luau scene 或 engine runtime 問題。PowerShell object model 不應成為遊戲 payload 的中間格式。

## 修正

build script 只解析 project config 取得入口路徑；script 與 scene 保留原始 JSON source，僅對 project name/script string 做必要的 JSON escaping，直接組出已驗證的 host payload。這避免無界深度序列化，也保留遊戲端 source 的可追溯性。

## 回歸

修正後 Angry Birds APK build 在相同 Windows/NDK/JDK 環境成功完成；payload 可由 Android host 載入，Canvas 可顯示 bird/pig/block。
