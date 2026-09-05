# Issue：mobile reload 不會自動呼叫 Game.start

日期：2026-09-05

## 症狀

Android smoke harness 在 `unone_mobile_reload_script` 成功後，預期新腳本的 `Game.start` 立即發布 observation；實際結果是 `event=script_reloaded`，world state 與原腳本 observation 保留。

## 分類

這是 harness 對既有 reload contract 的錯誤假設，不是 runtime bug。reload 的語意是替換 Luau source、保留 engine world 與舊 state；它不重跑 start，也不自動 tick。

## 修正

harness 改為檢查 `script_reloaded` lifecycle event，接著送 semantic `advance` input 並 tick，再驗證新腳本輸出 `reloaded_advanced`。如此同時驗證「reload 不重置 state」與「下一個 tick 使用新腳本」。

## 教學規則

需要看到新腳本的 update 結果時，reload 後明確送下一個 `InputFrame`／tick；不要把 `reload` 誤當成 `start` 或 full project reload。這個語意維持與 native preview、Web C ABI 以及 mobile FFI 一致。
