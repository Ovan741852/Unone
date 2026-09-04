# Issue：Emscripten cdylib link 需要 vendored Luau 的 PIC objects

- 日期：2026-09-05
- 範圍：Web smoke host／Emscripten linker
- 狀態：目前已解決（smoke 改用主模組 executable）；side module 暫不屬於產品需求

## 現象

最小 Web smoke crate 以 `cdylib` 建置時，Emscripten linker 進入 `SIDE_MODULE` 模式，對 `mlua-sys` vendored Luau objects 回報：

```text
relocation R_WASM_MEMORY_ADDR_SLEB cannot be used ...; recompile with -fPIC
```

## 判定

這是 Emscripten side-module／C++ PIC 建置邊界，不是 Luau 腳本、game logic 或 world simulation 問題。若只在 link command 強插 flags，可能讓本機通過但破壞 cc-rs 其他 target。

## 修正與驗證

smoke host 改成 Emscripten 主模組 executable，避免不必要的 `SIDE_MODULE`。重新編譯 vendored Luau 時設定 `CXXFLAGS_wasm32_unknown_emscripten=-fwasm-exceptions`，讓 C++ objects 與 Rust target 的 exception model 一致；若 build cache 是舊 flags，需先清理 `mlua-sys` target artifacts。

驗證結果：`cargo build -p unone-web-smoke --target wasm32-unknown-emscripten` 成功；Node 需加 `--experimental-wasm-exnref` 才能執行生成的 Emscripten `.js`，成功完成 60 frames 並輸出 observation digest。瀏覽器 WebGPU host 仍是後續工作；目前不把 `cdylib` 當成產品架構。
