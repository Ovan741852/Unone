# Decision 0024：最小資產引用契約先於 AssetManager

日期：2026-09-05

## 背景

七款驗證遊戲的 scene 已經使用 `asset://...` 或 `mesh://...` 識別字，但目前沒有統一的 asset manifest；bundle pack 也只知道 project、script、scene。這會讓 AI 只能看到一個 opaque id，無法回答 source 是否存在、該資產屬於哪個 bundle，或 host 為什麼無法解析。

## 決定

新增遊戲端可選的 `asset_manifest` 專案設定與 `game asset inspect`／`unone_asset_inspect` operation。

```json
{
  "version": 1,
  "assets": [
    {
      "id": "asset://characters/bird/red",
      "source": "assets/characters/bird/red.png",
      "kind": "texture2d",
      "bundle": "content"
    }
  ]
}
```

Engine 只驗證四件事：stable id、project-relative source、kind、bundle id；會從主場景列出 sprite/mesh3d 的靜態引用，回報缺少的 id、source 與 bundle，並明確說明 Luau 動態選擇的資產不在靜態檢查範圍。

Engine 不因此取得資產載入、解碼、GPU handle、下載、重試、配額、引用計數或遊戲 catalog。這些只有在兩款以上遊戲證明「相同語意的 runtime 問題」後才可進入下一個最小 slice；否則留在 host、content pipeline 或遊戲端。

## 原因

- 資產缺漏是跨多款遊戲的共通阻塞，值得先提供一個可測試的事實檢查。
- manifest 的 bundle 欄位讓未來分包可以有明確歸屬，但不假裝目前已有 archive/cooker。
- 省略 AssetManager 不會阻擋目前 headless simulation；它避免把平台儲存與 GPU 資源生命週期誤塞入 engine core。

## 已知限制與下一步

- 目前正式遊戲尚未全面宣告 asset manifest，也尚未有實際美術 source；因此 `asset inspect` 會如實回報缺漏，不能把此命令當成資產 pipeline 通過。
- 下一步應先為一款 2D 遊戲建立真實 texture source、content bundle 與 Web/native host resolve smoke，再判斷是否需要共同的 runtime asset lease。
- 不支援由 Luau 字串拼接產生的動態 asset reference 靜態分析；若該問題實際阻擋驗收，應先加遊戲端可觀測的 resolve error，再評估更大的工具功能。
