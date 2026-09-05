# Host asset resolve

日期：2026-09-05

## 目的

接續 asset reference contract 的下一個切片：讓「宣告的資產真的能被 host 取出」變成可驗證的事實。先前只有 Web host 的 JavaScript 會讀 asset archive，Rust 端只會寫；native 與 mobile host 沒有任何取得資產位元組的路徑，格式也沒有 writer/reader 一致性的回歸測試。

## 實作

- `unone_engine::read_asset_from_archive`：Rust 端的 archive version 1 reader，回傳單筆資產位元組。
- `BundleManager::read_active_bundle`／`read_active_asset`／`active_generation`：只讀取目前 active generation 且雜湊仍相符的快取內容。
- `unone_engine::read_asset`：由 project 的 asset manifest 找 id，交給 BundleManager 解析，回報 `size_bytes`、`sha256`、`bundle_generation` 與 host 責任清單。
- CLI `game asset read --id <asset-id> [--output <path>]` 與 MCP `unone_asset_read`（工具數 14 → 15）。
- 兩端都改為額外驗證 archive entry 自己的 sha256；Web host 缺少 Web Crypto 時回報 `ASSET_CONTENT_UNVERIFIABLE`，不靜默略過。
- 錯誤碼與 Web host 對齊：`BUNDLE_GENERATION_MISMATCH`、`BUNDLE_CACHE_MISS`、`BUNDLE_CACHE_CORRUPT`、`ASSET_ID_NOT_DECLARED`、`ASSET_NOT_IN_BUNDLE`、`ASSET_ARCHIVE_INVALID`、`ASSET_CONTENT_CORRUPT`。

## 驗證

```text
cargo clippy --workspace --all-targets -- -D warnings   PASS
cargo test --workspace                                  PASS (新增 4 個 archive/read 測試)
scripts/mcp-smoke.ps1                                   PASS (15 tools)
```

Angry Birds 2D 的三筆真實 SVG 資產，native CLI 由 generation 2 解析的位元組與 sha256，和專案內 source 檔案、以及瀏覽器端對同一份 `content.bundle` 逐 entry 計算的 sha256 完全一致：

```text
asset://characters/bird/red      599  1147502539f9dab0783bd52be9b966ffa4568b872c0f4bc2eb42ca6c3fa2e065
asset://characters/pig/basic     656  c98be7e7a429353d25702254e034c0aa46c4cdfc3a50d2e30c80428bdc5a8d29
asset://structures/wood/block    414  d3a96d6046b8d50745326a01dc7d3467d152fe12077f289ab9cbe1423e44346c
```

MCP `unone_asset_read` 也在同一個專案回報相同 digest 與 `bundle_generation: 2`。

## 已知限制

- 瀏覽器端這次只驗證 archive 解析與 entry digest：本次使用的瀏覽器沒有 WebGPU adapter，`web/runner/` 顯示 `WebGPU adapter is not available`，因此沒有重跑完整 runner smoke。這是驗證環境限制，不是本輪修改造成的。
- `game preview` 仍以 rigidbody 類型上色，沒有讀取 `sprite.asset`；不得把本輪說成 native 貼圖渲染通過。
- 目前一次讀入整份 bundle，沒有串流；正式 gate 仍是 0/7。

## 決策與下一步

此輪採用 Decision 0026。下一步是讓 native preview 與 Android host 實際消費 `read_active_asset`，再比對兩個 host 對同一 asset id 的 sha256 與畫面。
