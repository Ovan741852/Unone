# Issue：Android lifecycle smoke 重新啟動了第二個 Activity

日期：2026-09-05  
範圍：`platform/android/AndroidManifest.xml`、`scripts/run-android-apk-smoke.ps1`

## 症狀

APK 可正常安裝與顯示，但 smoke 以 `am start` 回到 app 時，standard launch mode 建立第二個 `UnoneActivity`。這使第二個 instance 重新 load project，而不是驗證原本 session 的 `onPause → onResume`；`runtime_resumed` lifecycle log 因此缺失。

## 分類

這是 Android host lifecycle smoke／Activity launch policy 問題，不是 engine runtime 問題。遊戲 host 的單一 session 必須有明確的 Activity instance 邊界，測試也必須證明同一 session 回到前景。

## 修正

Manifest 將遊戲 Activity 設為 `singleTask`，讓從 launcher/adb 回到 app 時重用現有 instance，走同一個 Rust FFI session 的 resume path；smoke 同時檢查 `runtime_paused`、`runtime_resumed`、前景 Activity、process 與 logcat。
