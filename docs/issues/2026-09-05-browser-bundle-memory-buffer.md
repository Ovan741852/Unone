# Issue：browser bundle smoke 仍會在驗證後暫存完整 Blob

- 日期：2026-09-05
- 範圍：`web/live/bundle-store.js`
- 分類：Performance / host storage follow-up
- 狀態：已記錄，非目前 smoke blocker

## 現象

目前 Web smoke 以 `ReadableStream` 分 chunk 送入 Rust verifier，但為了在 IndexedDB transaction 中保存內容，仍會把 response chunks 收集成 `Blob`。它避免了把整個檔案交給 WebCrypto digest，卻尚未消除「response chunks、Blob 與 storage write 同時存在」的高峰。

## 影響與處理界線

小型 project/script bundle 的 smoke 不受影響；大型 texture/audio/scene bundle 可能遇到記憶體尖峰、IndexedDB quota 或 transaction time limit。這是 Web host storage architecture 問題，不應把 Blob/IndexedDB API 加進 engine core。

## 後續設計

正式 asset streaming 前，選擇一個 host writer：Chromium/桌面 Web 優先評估 OPFS writable stream，其他 Web fallback 使用 chunked object store；每個 chunk 先經 `BundleVerifier::update`，writer 完成後才提交 content hash record。若中斷，staging key 可清理，不改 active generation。此項目在 production asset budget 與至少一個真實遊戲 asset 壓測前不宣稱完成。
