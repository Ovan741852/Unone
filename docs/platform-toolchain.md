# Platform toolchain

這份文件只記錄目前已驗證的建置邊界，不把某台機器上的 SDK 路徑假裝成產品設定。

## Native

`rust-toolchain.toml` 固定 Rust channel 與目前需要的 Web targets。一般 native 開發直接執行：

```powershell
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## 型別檢查工具

`game check --types` 需要官方 `luau-analyze`。它是開發期工具，刻意不進 repo
（[Decision 0005](decisions/0005-luau-analyzer-toolchain.md)），所以 clone 下來
要先裝一次；腳本會對 pinned 0.734 的下載內容比對記錄下來的 sha256，不合就中止：

```powershell
powershell -File scripts/install-luau-analyze.ps1
```

```sh
sh scripts/install-luau-analyze.sh   # Linux、macOS、Git Bash
```

裝好之後 CLI 從 repo 內任何一層目錄都找得到它。已經有自己的 analyzer 就設
`UNONE_LUAU_ANALYZER` 指過去，不需要跑這支腳本。

三個平台的 hash 都是從官方 release 下載後在本機算出來的，但**只有 Windows 那顆
真的被執行過**；Linux 與 macOS 的壓縮檔只做了下載與內容雜湊，沒有跑過。

## Web library compile

目前已在 Windows 以 Emscripten 3.1.39 wrapper 驗證 vendored Luau 能編譯。SDK 路徑應由開發機或 CI 注入，不寫入 Cargo config。

`scripts/build-web-live.ps1` 依序讀 `-EmsdkRoot` 參數、`UNONE_EMSDK_ROOT`、
`EMSDK`；都沒有時只會採用本機那個確實存在的 Unity WebGL BuildTools 路徑，否則
直接報「沒有 Emscripten」並指回這份文件——它以前把那個路徑寫死，在別台機器上
會設出無效的環境變數，然後以一個看不懂的 linker 錯誤收場。

手動設定的完整內容：

```powershell
$UnoneEmsdkRoot = 'D:/path/to/emsdk'
$UnoneEmscriptenRoot = Join-Path $UnoneEmsdkRoot 'emscripten'
$UnoneHostNode = (Get-Command node -ErrorAction Stop).Source
$env:EMSDK = $UnoneEmsdkRoot
$env:EM_CONFIG = Join-Path $UnoneEmsdkRoot '.emscripten'
$env:EMSDK_PYTHON = Join-Path $UnoneEmsdkRoot 'python/python.exe'
$env:PATH = "$UnoneEmscriptenRoot;$UnoneEmsdkRoot/node;$UnoneEmsdkRoot/python;$UnoneEmsdkRoot/binaryen;$env:PATH"
$env:CC_wasm32_unknown_emscripten = Join-Path $UnoneEmscriptenRoot 'emcc.bat'
$env:CXX_wasm32_unknown_emscripten = Join-Path $UnoneEmscriptenRoot 'em++.bat'
$env:AR_wasm32_unknown_emscripten = Join-Path $UnoneEmscriptenRoot 'emar.bat'
$env:CXXFLAGS_wasm32_unknown_emscripten = '-fwasm-exceptions'
cargo check -p unone-engine --target wasm32-unknown-emscripten
cargo build -p unone-web-smoke --target wasm32-unknown-emscripten
```

必須使用 `wasm32-unknown-emscripten`。`wasm32-unknown-unknown` 會讓 Cargo 將 C++ compile target 傳給 wrapper，覆蓋 Emscripten 的 sysroot/thread 設定；只換 clang++ 不足以修正它。

`CXXFLAGS_wasm32_unknown_emscripten=-fwasm-exceptions` 用來讓 vendored Luau C++ objects 與 Rust Emscripten target 的 exception model 一致。若之前用另一組 exception flags 編過 `mlua-sys`，先清掉該 target 的 `mlua-sys` build artifacts，再重建：

```powershell
cargo clean -p mlua-sys --target wasm32-unknown-emscripten
```

目前 smoke artifact 可由 Node 執行（`.js` 與同目錄 `.wasm` 必須一起存在）：

```powershell
& $UnoneHostNode --experimental-wasm-exnref target/wasm32-unknown-emscripten/debug/deps/unone_web_smoke.js
```

目前 host Node 需要 `--experimental-wasm-exnref` 才能載入這個 Emscripten exception section；要在修改 `PATH` 前先記住 host Node，避免誤執行 Emscripten SDK 內不支援該 flag 的舊 Node。成功時會印出 `unone_web_smoke completed: sha256:...`；這證明 memory-backed Luau runtime 已完成 link 並執行 60 frames，但仍不是瀏覽器 WebGPU page。

## Browser runtime smoke

完成 build 後，在 repo root 啟動靜態 server：

```powershell
python scripts/serve-player.py --directory . --port 8000 --no-cache
```

開啟 `http://127.0.0.1:8000/web/smoke/`。`web/smoke/index.html` 會載入同一份 Emscripten `.js + .wasm`，頁面顯示 `passed: 60 deterministic frames executed` 才算 browser runtime smoke 通過。這仍不是 WebGPU renderer、瀏覽器輸入或正式遊戲 host。

這裡以 repo root 為 server root，供 source smoke 使用；正式遊戲請依
[player export](player-export.md) 輸出後，以同一 helper 的 `--directory` 指向
export 目錄。Helper 固定 `.js`／`.mjs` 的 JavaScript MIME 與 `.wasm` 的
`application/wasm`，避免 Windows 的系統 MIME 設定讓 module 被當成
`text/plain`。若改用其他 static server，也必須提供這些 MIME types。

## Mobile host 盤點

目前 engine core 不依賴 UIKit、Android View 或 JNI；mobile host 應沿用 `EngineRuntime::tick_with_input`，由平台 adapter 負責 lifecycle、surface、safe area、touch、storage 與 package/update policy。這台 Windows 已用 Android NDK `27.1.12297006` 成功 cross-check `unone-engine` 與 `unone-mobile-ffi` 的 `aarch64-linux-android`、`x86_64-linux-android`，以 `Pixel_8` API 34 emulator 通過 headless `unone-mobile-android-smoke`，並以同一 FFI 建立可安裝的 x86_64 debug APK，驗證 project payload、Canvas host、前景 Activity、process、pause/resume lifecycle 與觸控可視化。沒有 Gradle 與 Apple `xcodebuild`，所以 production Android renderer/asset/bundle host、七款遊戲的 mobile smoke 與 iOS host 仍未完成。完整責任邊界與驗收項目見 `docs/decisions/0017-mobile-host-lifecycle-boundary.md`，盤點細節見 `docs/issues/2026-09-05-mobile-host-toolchain-audit.md`。

Android engine/host-adapter cross-check 可用：

```powershell
.\scripts\check-android-engine.ps1
.\scripts\run-android-mobile-smoke.ps1
```

前者驗證 engine/adapter 可被 Android target 編譯；`run-android-mobile-smoke.ps1` 執行 headless C ABI host smoke；`build-android-apk.ps1`／`run-android-apk-smoke.ps1` 會建立並在 emulator 安裝真正 APK，驗證最小 Java/Canvas/JNI host 與 lifecycle。這個 APK host 仍不取代 Android production GPU renderer、實際資產/ bundle、正式遊戲內容或 release signing。

APK host smoke 可用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/build-android-apk.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/run-android-apk-smoke.ps1
```

## 尚未完成

- CI 尚未固定下載 Emscripten SDK 的來源與 checksum。
- `unone-web-smoke` 與 `web/smoke/index.html` 已驗證 Emscripten memory-source runtime；`web/live/index.html` 另已驗證窄 C ABI、WebGPU live loop、browser input、bundle verifier、IndexedDB generation/cache 與 script hot update。兩者都不是完整 Web 發布頁面。
- 大型 asset 的 OPFS/chunked storage writer、CDN policy、背景下載、production Android GPU/asset/bundle host 與 iOS host 尚未完成；Android headless FFI 與最小 APK host lifecycle smoke 已通過。
- 這裡的 `cargo check`／smoke artifact 不等於完整 Web 發布包。
