# Issue：Android APK host 初次 build 誤用 Windows JNI headers

日期：2026-09-05  
範圍：`scripts/build-android-apk.ps1`、`platform/android/native/unone_android_host.c`

## 症狀

首次執行 APK build 時，NDK target compiler 讀到 Windows JDK 的 `include/win32/jni_md.h`，出現 `__int64`、`__declspec` 與 `__stdcall` 不適用於 Android target 的錯誤；因此尚未產生 JNI host `.so`。

## 分類

這是 Android host build tooling 的平台配置問題，不是 engine/FFI API 或架構問題。JNI glue 必須以 target-side headers 編譯，不能把 desktop JDK ABI header 當成 Android header。

## 修正

build script 改用 NDK `sysroot/usr/include/jni.h`，JDK 只負責 `javac`、`d8`、`jar` 與簽章工具；engine core 與 `unone-mobile-ffi` ABI 不變。

## 驗證

修正後重新執行 `build-android-apk.ps1`；若後續仍有錯誤，需分別記錄 JNI compile、APK packaging 與 emulator runtime，不把它們混為同一個問題。
