# 不把「沒有工具」和「工具不夠可靠」混為一談

日期：2026-09-06。狀態：plan_rereview_pending；未新增引擎功能。

新一份第三方回饋把十類自主製作障礙排了優先順序。主代理先對照 source，
沒有把全部描述當成既有事實：project init/MCP、位置斷言、state observation、
lifecycle trace、replay diff 都已存在。音訊、通用 sprite animation、跨 host
畫面和完整 3D/UI 工作流則確有未交付能力。

小型實跑找出更精確的問題：新 project 成功建立但沒有 tests；玩法搜尋
沒有結果也沒有有效下一步；scene typo 被忽略、同 id 的物件被後一筆覆寫。
兩個場景反例都回 ok=true，足以誤導只看結果的 AI。詳見
[問題與原始證據](../issues/2026-09-06-ai-authoring-gaps.md)。

因此第一切片規劃為既有 scaffold/test/feedback 與共用 scene input correctness。
不先新增 prefab graph、任意 scene mutation、runtime eval console，也不把
音訊或 renderer 缺口永久降成教學问题。未來 host/engine 依賴與 seven-game
final gates 仍明確，不能把 starter 綠燈當真正遊戲完成。

計畫 v1 及首批證據已本地 commit `8f6d9b3`；Aquinas（Luna/max）未繼承主對話，
只審計畫、必要 source/contract，主代理另補反例與紀錄。
第一輪指出三個計畫 blocker：scene consumer/error transport、init 部分寫入、
遊戲與 starter gate 不夠分明。主代理已修成 v2 並直接取代 v1，未留現行舊規格；
另採納 API parity 與具名前案 gate 證據建議。
[逐項處置](../reviews/2026-09-06-ai-authoring-plan.md) 待限定複審。
roadmap 同步移除「別家引擎有就全部都要有」的無界原則，改由實際驗證遊戲
需要的通用機制決定；不把系統開關當成無限制增加功能的理由。必要音訊／碰撞／
渲染仍由引擎負責，並非刪掉難做的機制。API 空搜尋的現況也改成正確描述，
不再暗示一定需要新增 api list。
本輪沒有新增 screenshot／平台驗證，不拿先前畫面冒充本輪成果。
