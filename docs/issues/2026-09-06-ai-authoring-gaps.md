# AI authoring：事實與範圍

日期：2026-09-06。狀態：plan_rereview_pending，不是功能已修好。
Baseline source c187df8；CLI4a128d7（init/search/scene 路徑未變）。

## 可重現問題

1. `project init` 存在且成功建立三個檔案；官方 Luau types pass，卻因沒有
   test_files 令 verify 回 `TESTS_NOT_CONFIGURED`。這不是「沒有 scaffold」，
   是 starter 無法走到同一份驗證契約的教學／產物缺口。
2. 搜尋玩法動詞「攻擊」：API_SEARCH_EMPTY warning，suggested_actions=[]。
   這不證明引擎需要 attack API，但 AI 缺少回到 primitive 索引的指引。
3. scene entity 的 transform 誤寫成 position：run exit0/oktrue，marker
   在原點，無任何 diagnostic。schema 不允許該欄位，runtime serde 忽略它。
4. 同 scene 兩筆同 id：run exit0/oktrue，第二筆覆寫第一筆，world 只剩一筆。

[1–3 證據](../evidence/2026-09-06-ai-authoring/initial-probes.json)，
[4 證據](../evidence/2026-09-06-ai-authoring/duplicate-entity-id-before.json)。
探針均為主代理自己的 C:/Temp 小型專案，沒有修改任何驗證遊戲，也沒有大檔 build。

## 分類與計畫

- 1/2：developer tooling 與 discovery 契約；補 existing entry point/feedback，
  不另造名稱不同但行為相同的 CLI。
- 3/4：共用資料輸入邊界／架構問題，多個 host/pack/runtime 會消費場景。
  應在共用 scene ingestion 拒絕，不以遊戲繞過或新增 scene CRUD UI 掩蓋。
- 音訊、general sprite animation、host rendering、UI/3D pipeline 是真正缺口，
  但不是把它們一次塞進 scaffold；繼續做遊戲引擎必要功能，分垂直切片驗證。

[第一切片計畫](../work-packages/2026-09-06-ai-authoring.md) 已送獨立 Luna/max
計畫審查。上一輪 asset WIP 的 Rust/平台/package-only gate 先於新功能開工；
磁碟快取清理許可尚待使用者，不會把提供另一份建議視為刪除授權。
