# 不把「沒有工具」和「工具不夠可靠」混為一談

日期：2026-09-06。狀態：plan_review_closed / implementation_waiting_predecessor；未新增引擎功能。

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
[逐項處置](../reviews/2026-09-06-ai-authoring-plan.md) 已完成限定複審：
v2（629824f）的三項計畫 blocker 均解除，兩项建議已採納，未發現新具體阻塞。
這是計畫層結論，source 仍待實作；上輪 asset build/platform/package gate
先於新功能開工。主代理驗證本輪5份 authoring 文件相對連結無缺失、兩份
baseline evidence JSON 可解析、git diff --check 通過；未拿這些取代功能測試。
roadmap 同步移除「別家引擎有就全部都要有」的無界原則，改由實際驗證遊戲
需要的通用機制決定；不把系統開關當成無限制增加功能的理由。必要音訊／碰撞／
渲染仍由引擎負責，並非刪掉難做的機制。API 空搜尋的現況也改成正確描述，
不再暗示一定需要新增 api list。
本輪沒有新增 screenshot／平台驗證，不拿先前畫面冒充本輪成果。

## Implementation follow-up

## Predecessor integration

使用者要求推進後，主代理核對 package-only 資產評估。實際12檔 hash 相符，
重跑 verify 四 gate／兩 tests 成功；native read hero sha符合作者檔，active六包
皆 valid。實際 Web IndexedDB 啟用 manifest version3，browser generation1，
六包 hash 與 native generation3 相同。它們是獨立 host counter，不能要求數字相等。
截圖保留既有 Web center-offset；不宣稱 background/位置或平台 renderer 通過。

交付紀錄不足：command-log 是摘要，不是完整 stdout JSON。已退回補存要求，
取不到首輪完整輸出須明說，另建隔離 fixture 重跑並標 rerun。不得從摘要編造
首次 raw evidence。這是驗收記錄問題，不因功能最後成功就抹掉。

資產教學噪音由 Luna/max Sagan 修兩份 current docs；不改 immutable package。
本次使用者「推進」接續最小教學修正，不新增 engine 功能、update CLI 或強迫 UI/save。

## Production owners (prepared, not yet writing)

- McClintock：A project.rs／專屬 init tests。
- Lovelace：B world/runtime/scene、asset readers、pack、Web/mobile ingestion 與 lib exports。
- Meitner：C api.rs、CLI main/MCP、專屬 parity tests。

三位 Luna/max 已收到計畫與互斥 write sets；前置 gate released 前僅讀取準備。
主代理統一建置、整合 export、現行文件、review、平台封裝與新盲評。
Cargo 暫時維持 incremental=0/jobs=1，不改全域設定、不刪其他快取。

## Gate released / 實作開工

84f6892 關閉限定資產前案：15份重跑raw保存；主代理另用自己的fixture改成
缺companion宣告，pack exit1 ASSET_SOURCE_NOT_FOUND，整份 .unone/bundles
file sets與hash不變，恢復原宣告。首輪完整stdout/before hash未保存仍明列缺口。
不是由gen1到gen2的合法install前後比較來假稱failure invariant。
三位製作者已收到 gate released 並開始A/B/C，驗收尚未完成。

中途整合 check（不當finalgate）先抓到A尚缺path_string helper，以及B的
SceneSource generic impl以Self回傳static造成lifetime錯誤、殘留Value import。
已分別回owner；不改規格、不由這次未完成快照宣稱功能失敗或通過。

使用者追加 Claude workflow 架構盲評：安排在本批基本驗證後，用獨立無歷史
session、只交現行契約，不給既有審查結論。與定期source review及package-only
遊戲盲评分開，未執行前不得填完成。

下一次workspace test在CLI transport測試遇E0499（二次mutable borrow）；
已回C修正。主代理同時指出effects預期應按absolute path排序，而非effect前綴；
測試目錄名稱應含真正空白，不以中文「空白」冒充。此輪尚未測試通過。

## Workflow 盲評與接續順序

64a702a 保存 Claude 無工具／無歷史 workflow 盲評的輸入、stdout與主代理取捨。
六項意見以 current docs 原地修正可證明的矛盾；拒絕 init 紀錄即安全刪除清單、
以及 pack 已改 hash 仍可 read 舊 active 的錯誤推演。不將文件盲評當架構通過。
使用者同意 authoring 完成後優先處理熱更新失敗一致性：先重現、設計審查再製作。
老虎機仍是 in_progress 的 validation slice，不將 Web 特效展示當七款 final gate。

中途 workspace test 161個harness tests exit0（Windows權限案例仍可能內部skip）；
隨後 clippy 的大型 Err 與 io::Error helper 已交A窄修。B補齊consumer負例矩陣後
重跑最終驗證。新Luna/max Newton只讀A/C source做獨立審查，不讀歷次review答案。

## Candidate integration checkpoint

B完成五類負例跨disk/typed/asset/pack/Web/mobile ABI矩陣。workspace165個harness
tests exit0，三個Windows symlink權限skip原文保留；主代理另建Windows junction，
root/祖先兩條init路徑皆PROJECT_ROOT_INVALID、effects空，真實target仍空。
init回傳四組argv在空白/Unicode新root實際執行，verify/pack/install-all/inspect全成功。
Node六項回歸成功；移動test-only SceneFile import後clippy all-targets -D warnings成功。
證據位於evidence/2026-09-06-ai-authoring，並保留較早失敗輸出。

建立本地candidate checkpoint後重建CLI/Wasm/mobile；Newton source review與新Claude
source review仍進行中。封裝及新的遊戲盲評未完成，不標authoring交付或七款passed。
