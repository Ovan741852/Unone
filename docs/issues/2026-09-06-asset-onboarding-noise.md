# Asset-only onboarding noise

日期：2026-09-06。狀態：fixed_in_source_docs，待下一封裝盲評確認教學效果。分類：docs/tooling。

封裝 fe8d122 的獨立資產評估中，初始 `ui preview --strict` 回
`UI_TREE_NOT_PUBLISHED`。代理後續建立 UI/save tests，雖然資產維護企劃不要求它們。
這證明發現流程包含額外工作；不能僅由此斷言文件是唯一原因。

主代理核對現行 ai-agent-game-handoff.md：初始必跑清單含 UI preview，
但後文正確說 verify 對無 UI 的專案是 not_applicable。第50行又說 asset init
「建立／更新 manifest declaration」，與同 id 被 ASSET_MANIFEST_DUPLICATE_ID
拒絕、canonical asset-workflow 要求直接改既有 entry 的契約不夠一致。

建議只調整現行教學，按企劃判斷 UI/save 是否適用；asset init 明確為新增
declaration，修改既有 source/files 直接改原 entry。不要為文件噪音新增
update/replace 同義 CLI 或 UI/save engine 功能。舊敘述直接替換，歷史留 Git。

使用者後續要求「推進」，由 Sagan（Luna/max）修正兩份現行教學，主代理覆核
並明確区分 verify 的 not_applicable 與直接 UI preview 的 error；不再宣稱引擎
依 GAME_PLAN 自動判斷。舊 immutable package 不變；實際教學效果待新封裝盲評。
