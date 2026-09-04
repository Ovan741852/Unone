# Issue：Web target 的 vendored Luau 編譯工具鏈

- 日期：2026-09-05
- 範圍：Web platform toolchain／script host build
- 狀態：engine library 的 Web compile 已解除；瀏覽器 WebGPU host 尚未完成

## 重現

```powershell
cargo check -p unone-engine --target wasm32-unknown-unknown
```

`wasm32-unknown-unknown` target 已安裝，但 `mlua-sys` 在編譯 vendored `luau0-src` 時回報：

```text
Compiler family detection failed ... ToolNotFound: failed to find tool "clang++"
```

## 第一個判定

這不是 Rust engine API 或遊戲邏輯問題，而是平台／建置架構問題。現有 native runtime 仍可編譯；第一輪 Web runtime 的 Luau host 尚未被驗證。

## 嘗試

- `winget show LLVM.LLVM` 找到 LLVM 22.1.8。
- 官方 installer SHA-256 已驗證；專案內 silent install 被 Windows 取消，沒有完成安裝，也沒有改動系統工具鏈。
- 直接使用 Unity 內附的 `clang++.exe` 時，編譯器啟動但缺少適用的 C++／C sysroot；這條路不應被當成 Web toolchain。

## 解法與驗證

本機已找到完整的 Unity Emscripten SDK，並安裝 Rust target：

```powershell
rustup target add wasm32-unknown-emscripten
```

設定 `EMSDK`、`EM_CONFIG` 指向 SDK 根目錄的 `.emscripten`，再把 `CC_wasm32_unknown_emscripten`、`CXX_wasm32_unknown_emscripten` 與 `AR_wasm32_unknown_emscripten` 指向 Emscripten wrapper。以 `wasm32-unknown-emscripten` 執行：

```powershell
cargo check -p unone-engine --target wasm32-unknown-emscripten
```

結果：通過，`mlua-sys` vendored Luau 與 `unone-engine` 均成功編譯。此前失敗的 `wasm32-unknown-unknown` 是因 Cargo 傳入的 target 會覆蓋 Emscripten target，造成 libc++ 回報 `No thread API`；不能只替換 `clang++` 來解決。

## 目前邊界

- 這次證據是 `unone-engine` library 的 Web compile，不等於瀏覽器頁面已能顯示 WebGPU。
- `EngineRuntime::load_source` 已提供必要的 host 邊界：Web host 可自行 fetch manifest／scene／Luau source，再交給同一個 runtime；native 仍使用檔案系統。
- Web fetch、cache quota、IndexedDB／Storage、Canvas／WebGPU lifecycle 不進 engine core，留在 platform host。
- 仍需建立最小 Web host／WebGPU smoke page，並在 CI 固定 Emscripten 與 Rust target 來源，不能依賴某台電腦的 Unity 安裝路徑。

## 後續

建立可重現的 CI／開發 toolchain，固定 Emscripten、Luau analyzer 與 embedded Luau 版本；完成最小 Web host／WebGPU smoke，再驗證同一個 Luau scene 可在 native 與 Web 執行。若未來 `mlua` 的 native C host 在瀏覽器限制下不適合，改採獨立的 Web Luau host adapter，不在遊戲端繞過引擎 contract。
