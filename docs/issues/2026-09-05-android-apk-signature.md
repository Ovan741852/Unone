# Issue：Android APK smoke 重建時 debug signature 不穩定

日期：2026-09-05  
範圍：`scripts/build-android-apk.ps1`、`scripts/run-android-apk-smoke.ps1`

## 症狀

APK 第一次安裝成功；重新 build 時因 build directory 被清除，script 重新產生另一把 debug keystore。`adb install -r` 回報 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，使 host 不能以 incremental install 方式驗證。

## 分類

這是 Android packaging/dev workflow 問題，不是 engine、JNI 或 runtime 問題。清理編譯產物不應同時清理開發安裝身份。

## 修正

debug keystore 移到 `platform/android/debug.keystore`（已加入 `.gitignore`），build 目錄仍可安全重建；正式 release signing 不由這個 smoke script 處理。

## 回歸

重新 build 後使用 `run-android-apk-smoke.ps1` 驗證同一 emulator 的 `adb install -r`、前景 Activity、存活 process、UI dump 與當次 logcat。
