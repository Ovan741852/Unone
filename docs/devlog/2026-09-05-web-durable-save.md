# Web durable save host

日期：2026-09-05

## 變更

`web/runner/` 原本用 `localStorage` 保存 save payload，只能算 demo adapter。這輪改成每個遊戲 project 使用獨立 IndexedDB database，store 只有一個 `current` record；只在 payload JSON 改變時寫入，避免每個 animation frame 產生無意義的 storage request。host 不解析遊戲 schema，仍由 Luau 決定 version、驗證與 migration。

## 驗證

- 3D Racing：按 Accelerate／Save 後重新載入頁面，`save_store.backend=indexeddb`、`loaded=true`、UI `restored`，原 payload 與 bundle generation/hash 保持一致。
- 七款正式遊戲：逐一由 generic Web runner 載入，均無 `failed:`，且輸出包含 `save_store.backend=indexeddb`。
- 截圖在本輪 browser smoke 中取得：3D Racing debug scene、`restored`、IndexedDB save state 與 bundle generation 同時可見；瀏覽器暫存圖未冒充成 repo 本地 artifact。

## 邊界

這是 Web host durable storage smoke，不是 cloud save、跨裝置同步、加密或 production quota policy。engine 只提供 opaque `api.save.set/get` transport；若未來真實遊戲證明需要 schema/migration 共用能力，再另行評估是否加入最小 shared contract。
