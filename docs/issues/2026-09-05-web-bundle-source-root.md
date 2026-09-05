# Issue：Web bundle source 路徑基準錯誤

日期：2026-09-05

## 症狀

3D Racing 已由 `game bundle pack` 生成 manifest，generic Web runner 載入時回報：

```text
BUNDLE_FETCH_FAILED: bundle 'project' request failed
```

## 分類

這是 Web host adapter 的邏輯問題，不是 engine 的 bundle verifier 或架構問題。跨平台 `BundleSpec.source` 原本定義為相對遊戲專案根目錄；runner 卻用 manifest URL 當 base，導致 `bundles/manifest.json` 內的 `project.unone.json` 被請求成 `bundles/project.unone.json`。

## 修正

`web/runner/main.js` 由 host 以 `projectRoot` resolve source URL。engine 仍只接收相對路徑並負責本地檔案 verification；Web/mobile 的 URL、fetch 與 storage policy 留在 host。另將 generic runner 的 IndexedDB database 以 project path 區分，避免多款遊戲共享 active generation pointer。

## 回歸證據

- 3D Racing Web runner 持續執行並顯示 generation 1、project/script/scene hashes。
- `Install / reload active bundle` 通過同一 runtime 的 Luau hot reload。
- Save 後 reload 頁面可顯示 `restored`，save payload 保持不變。
- native `bundle inspect` 與 `bundle install script` 通過。

## 尚未解決

這不代表 production bundle 完成；OPFS/大檔 streaming、CDN/retry/quota policy、內容變更 hot-update fixture 與正式 mobile host 仍待驗證。
