# Asset reference contract

日期：2026-09-05

## 目的

處理七款遊戲共同的內容阻塞：scene 已有 `asset://...`／`mesh://...` ID，但沒有可讓 AI、bundle host 與跨平台 adapter 查證的 manifest。這輪只做必要的 reference inspect，不先建立泛用 AssetManager。

## 實作

- `ProjectConfig` 新增可選 `asset_manifest`，並在 `project inspect` 顯示檔案狀態。
- 新增 `AssetManifest`／`AssetSpec`：每筆資產只有 `id`、`source`、`kind`、`bundle`。
- 新增 `game asset inspect --json` 與 MCP `unone_asset_inspect`。
- inspect 從主場景收集 sprite／mesh3d 靜態 reference，檢查缺 ID、缺 source、未宣告 bundle、重複 ID、非法 project-relative path。
- 明確回報 scope：Luau 動態選資產不在靜態檢查範圍；引擎不下載、解碼、快取或管理 GPU handle。

## 驗證

```text
cargo clippy --workspace --all-targets -- -D warnings  PASS
cargo test --workspace                              PASS
scripts/mcp-smoke.ps1                              PASS (12 tools, asset diagnostic)
asset inspect: 8 validation projects executed       PASS (expected warnings only)
```

Angry Birds 與 3D Racing 的實際輸出都如實顯示 `ASSET_MANIFEST_MISSING` 及 scene asset IDs；沒有把 debug cube 或 opaque ID 說成真實 asset pipeline。

## 決策與剩餘工作

此輪採用 Decision 0024。正式 gate 仍是 `0/7`：尚未建立真實 texture/mesh source、content bundle、Web/native asset resolve、mobile/iOS host asset rendering。下一個實作切片應先用一款 2D 遊戲完成可跨 host 驗證的真實 texture source 與 content bundle，再判斷是否真的需要 runtime asset lease。

## Claude review

Claude CLI `2.1.260` 第 27 次以 plan/read-only prompt 執行，約 65 秒沒有 stdout/stderr，Ctrl+C 中止；沒有 findings，因此不算 review 通過。詳見 `docs/issues/2026-09-05-claude-cli-review-timeout-27.md`。
