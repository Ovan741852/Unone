# Issue：Web target 的 vendored Luau 編譯缺少 clang++

- 日期：2026-09-05
- 範圍：Web platform toolchain／script host build
- 影響：目前不能宣稱 `unone-engine` 已完成 Web smoke build

## 重現

```powershell
cargo check -p unone-engine --target wasm32-unknown-unknown
```

`wasm32-unknown-unknown` target 已安裝，但 `mlua-sys` 在編譯 vendored `luau0-src` 時回報：

```text
Compiler family detection failed ... ToolNotFound: failed to find tool "clang++"
```

## 判定

這不是 Rust engine API 或遊戲邏輯問題，而是平台／建置架構問題。現有 native runtime 仍可編譯；Web runtime 的 Luau host 尚未被驗證。

## 嘗試

- `winget show LLVM.LLVM` 找到 LLVM 22.1.8。
- 官方 installer SHA-256 已驗證；專案內 silent install 被 Windows 取消，沒有完成安裝，也沒有改動系統工具鏈。

## 後續

建立可重現的 CI／開發 toolchain，固定 clang++、Luau analyzer 與 embedded Luau 版本；再重跑同一個 wasm check。若 `mlua` 的 native C host 不適合 Web，改採獨立的 Web Luau host adapter，不在遊戲端繞過引擎 contract。
