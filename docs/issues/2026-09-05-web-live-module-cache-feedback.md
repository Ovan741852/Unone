# Issue：browser module cache 讓修正後的 live feedback 暫時仍顯示舊值

- 日期：2026-09-05
- 範圍：`web/live/main.js` 與 shared WebGPU host module 的本地迭代
- 分類：Tooling / developer feedback
- 狀態：已修正並回歸

## 重現

修改 live page 的 `frame` 讀取從 `snapshot.frame` 為 `world.frame` 後，直接 reload page 仍顯示 `passed: live WASM frame undefined`；DOM 同時已包含正確的 `world.frame`。

## 原因與修正

本地 browser 保留了先前由 module URL 載入的 JavaScript module；只改 page query 不會讓既有 module specifier 失效。對 live page 與 shared renderer 加入明確的版本 query，修改 host code 時更新版本，避免 AI 看到舊 module 的 feedback。

## 回歸

以新 module version reload 後 status 顯示數字 frame；project envelope、Luau hot reload、pointer drag 與 console clean smoke 均重新通過。長期若導入正式 dev server，應由 HMR/cache policy 取代手動版本 query。

