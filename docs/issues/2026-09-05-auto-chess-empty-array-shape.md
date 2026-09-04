# Issue: empty Luau tables do not identify array intent

日期：2026-09-05  
分類：Game data shape / JSON-like boundary  
狀態：resolved without engine expansion

## 重現

自走棋的 typed `shop: {ShopView}` 在沒有商品時發布空 Luau table。Luau table 同時可以代表 object 或 array，engine 的有限 JSON-like converter 因無 positive-integer keys 只能安全輸出 `{}`；fixture 若期待 `[]` 會失敗。

## 判斷

這不是 combat logic，也不是需要把 game-specific array marker 加進 engine 的架構問題；這是 dynamic serialization boundary 的已知資料形狀限制。為單一遊戲新增 wrapper 會污染所有遊戲的 API。

## 修正

- 自走棋的業務規則改為初始化即有三個 shop item，符合實際商店畫面，也避免空商店在第一個 frame 出現。
- 不新增 array marker、反射型 serializer 或 `AutoChess` 專用 API。
- 之後若某遊戲確實需要區分 empty array/object，先以 game-owned sentinel/schema 解決；只有多個遊戲共同阻塞才重新評估 engine contract。

## 回歸證據

- Auto Chess `check --types` 通過。
- seeded roll、battle round、save restore 三個 tests 在相同 typed observation shape 下通過。
