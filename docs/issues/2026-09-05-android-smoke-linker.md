# Issue：Android smoke binary 的 linker 與 C++ runtime 部署

日期：2026-09-05

## 症狀

`cargo check -p unone-mobile-android-smoke --target x86_64-linux-android` 通過，但第一次 `cargo build` 回報 `linker cc not found`。補上 `CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER` 後 binary 能編譯與 push，執行時又回報：

```text
CANNOT LINK EXECUTABLE: library "libc++_shared.so" not found
```

## 分類

這是 Android host/toolchain deployment 問題，不是 engine 架構問題。原本 Android check 只設定 C/C++ compiler，沒有設定 Rust final linker；emulator image 也不保證帶 NDK 的 shared C++ runtime。

## 修正

- `check-android-engine.ps1` 與 `run-android-mobile-smoke.ps1` 都設定 target linker。
- runner 從同一個 NDK sysroot 找到對應 ABI 的 `libc++_shared.so`，推送到 emulator 暫存目錄，以 `LD_LIBRARY_PATH` 啟動 smoke binary。
- SDK discovery 支援 `ANDROID_HOME`、`ANDROID_SDK_ROOT`，若兩者未設定則從 PATH 上的 `adb` 反推 SDK 根目錄。

## 回歸

`run-android-mobile-smoke.ps1` 已在 `emulator-5554` 通過，target 為 `x86_64-linux-android`；`check-android-engine.ps1` 也在 `aarch64-linux-android` 與 `x86_64-linux-android` 通過。

## 尚未解決

這只證明 headless FFI/runtime host boundary；APK packaging、Android View/GPU surface、實際遊戲 bundle/asset 與 production lifecycle policy 仍未完成。
