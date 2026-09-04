# 開發日誌：初始規劃

日期：2026-09-05

## 觀察

- `D:/Projects/Unone/` 目前沒有引擎原始碼。
- `D:/Projects/Unone_Games/` 目前是空的，尚未有驗證遊戲。
- 技術初稿已提出 Rust + Luau + wgpu + CLI/MCP + semantic diagnostics 的完整方向。

## 本次決策

- `Unone` 作為引擎工作區；`Unone_Games` 作為遊戲驗證工作區。
- 先做 native 2D 垂直切片，再用 Web smoke build 與憤怒鳥 2D 驗證。
- 不在第一階段同時建立 MCP、完整 Editor、3D、網路與多種測試格式。

## 證據與截圖

本次尚未有可截取的引擎畫面；等第一個 native app 能啟動後補上 screenshot。

## 下一步

建立 Rust workspace、2D sprite、Luau host、check/reload、headless observation 與第一個 regression test。

## 實作進度補記

- Rust workspace 與 vendored Luau host 已建立。
- `minimal-2d` 的 `game check` 通過，入口腳本使用 `--!strict`。
- `game run --headless --frames 60 --action Right` 通過；Player x=0 → x=4，產生 observation digest。
- 已加入 deterministic digest 與 failed-reload regression tests，待 `cargo test` 驗證。
