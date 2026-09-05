# Decision 0026：由已啟用 bundle generation 解析資產的 host 契約

日期：2026-09-05

## 背景

Decision 0024 只讓引擎檢查 asset reference 的事實：id、project-relative source、kind、bundle。實際把資產取出來的邏輯只存在於 Web host 的 JavaScript（`web/live/bundle-store.js` 的 `readActiveAsset`）。這造成兩個問題：

- Rust 端只會「寫」asset archive，不會「讀」；native 與 mobile host 沒有任何取得資產位元組的路徑，`asset inspect` 通過也無法證明資產真的能被解析。
- archive 格式的讀取契約只有單一實作，沒有回歸測試證明 writer 與 reader 對同一份 bytes 的解讀一致；格式一旦變動只會在瀏覽器裡失敗。

## 決定

把「由已啟用 generation 解析一筆宣告資產」變成 engine 契約，兩個 host 共用同一組語意錯誤碼。

- `unone_engine::read_asset_from_archive(archive, asset)`：解析 version 1 archive，回傳該筆資產的位元組。
- `BundleManager::read_active_bundle(bundle_id)`／`read_active_asset(asset)`：只讀取目前 active generation、且雜湊仍與 manifest 相符的快取內容。
- `BundleManager::active_generation()`：回報目前啟用的 generation。
- `game asset read --id <asset-id> [--output <path>]` 與 MCP `unone_asset_read`：回報 verified `size_bytes`、`sha256`、`bundle_generation`，並可選擇寫出位元組。

錯誤碼與 Web host 一致：`BUNDLE_NOT_FOUND`、`BUNDLE_GENERATION_MISMATCH`、`BUNDLE_CACHE_MISS`、`BUNDLE_CACHE_CORRUPT`、`ASSET_ARCHIVE_INVALID`、`ASSET_NOT_IN_BUNDLE`、`ASSET_ID_NOT_DECLARED`、`ASSET_CONTENT_CORRUPT`。

兩端都改為額外驗證 archive entry 自己的 `sha256`，而不是只信任外層 bundle 雜湊；Web host 在缺少 Web Crypto 時回報 `ASSET_CONTENT_UNVERIFIABLE`，不靜默略過驗證。

## 邊界

引擎仍然不解碼影像、不建立 GPU 資源、不下載、不重試、不管理快取容量、不決定 CDN 或 OPFS policy，也不提供 runtime asset lease 或引用計數。`asset read` 只是「已驗證的位元組加上可比對的事實」；host 拿到 bytes 之後的一切仍屬 host。

## 原因

- 這是七款遊戲共通的阻塞：沒有 host resolve，asset manifest 只是宣告。
- 讓 native/mobile 與 Web 走同一份 archive 契約，比先做 native texture 渲染更早暴露格式與整合問題。
- `sha256` 讓「同一個 asset id 在不同 host 得到相同位元組」成為可自動比對的事實，而不是靠畫面判斷。

## 已知限制與下一步

- 這輪不含 native/mobile 的實際貼圖渲染：`game preview` 仍以 rigidbody 類型上色，沒有讀取 `sprite.asset`。不得把 `asset read` 通過說成 native asset rendering 通過。
- 沒有串流讀取：目前一次讀入整份 bundle，適用於目前的小型驗證內容，不適用大型資產包。
- 下一步應在 native preview 與 Android host 消費 `read_active_asset`，並在同一款遊戲比對 Web 與 native 的 asset `sha256`，才算跨 host 資產解析成立。
