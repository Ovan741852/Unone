# 森林領主：GameDesignOS 專案檢視

## 樣本邊界

| 項目 | 範圍 |
| --- | --- |
| 本次材料 | 目前正式 Luau／UI／快測原始碼；新開隔離 Edge 視窗的 7 張截圖及約 7.5 秒自動化操作記錄；2 個 Luau 問題重現；3 個座標映射樣本；前一輪 seed 42 的三流派經濟快測 |
| 可以判斷 | 目前規則、購裝是否產生效果、敗北條件、工具座標誤差、畫面資訊層級，以及需要優先驗證的設計風險 |
| 不能判斷 | 真人操作手感、20 分鐘完整旅程是否好玩、玩家通關率、D1／D7、多人搶池公平性、商業成果 |
| 關鍵未知 | 新經濟多種子全程表現、新手能否說出勝利條件、如何區分裝備收益和派兵成本、怪物潮中可讀性、網路多人尚未實作 |
| 版本 | `2026-09-11-crystals-v1`；Luau SHA-256 `92a68f2889913eb7e64ebfa501fa55401e7d546e4ffdf1d51f260a532ce01da6`；本次確認 served payload 與 source 一致 |

路由採用 analyzer 的 `core_loop_diagnosis`，主模式 `gameplay_mechanics`，輔以 `ux_ui`、`problem_diagnosis`。品類為「漁機式派兵開獎＋Roguelike 構築＋城鎮場外養成」。不套用市場熱度或留存預測，也不把自動化點擊速度當成新手理解速度。

**判斷：玩法組件已經不少，眼前優先工作是讓配裝確實有用、敗北判定正確、快測忠於遊戲，並讓玩家看懂當前目標。** 金幣／結晶拆分和裝備提高派兵費可以形成有意義的取捨；但已有兩個規則錯誤會直接破壞這個取捨。

## 證據索引

| ID | 定位 | 觀察事實與限制 |
| --- | --- | --- |
| E001 | [shop.png](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/images/shop.png)；browser-sample `shop` | 320 金幣、18 結晶分開顯示，商品寫派兵加價。靜態資訊可以檢查，不能證明玩家已理解 |
| E002 | [gear.png](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/images/gear.png)；browser-sample `gear` | 真實 Canvas 購買並穿戴穿軍刃後，金幣仍 320、結晶 6、劍兵派兵費 10；武庫主要呈現圖示與說明，沒有同屏模型動作／攻擊效果比較 |
| E003 | [battle-auto.png](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/images/battle-auto.png) | 02:55、×1.6 +16 小獎、中央大片金色放射線；HUD 有時間、怪物破防及篩選，沒有大王出場倒數與通關條件。只是這一幀的可讀性證據 |
| E004 | [runtime-probes.json](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/runtime-probes.json) `duplicateSpin` | unchanged production Luau 的正常語意操作：槍兵買並穿上旋風長柄，花 15 結晶，派兵 20→26，完整合成 loadout 不變 |
| E005 | 同上 `bankruptcy`；[main.luau:669](D:/Projects/YesSir/_Games/ashen-legion/main.luau:669) | 明確標記的配装 fixture：20 金幣、三兵種費用 46／20／40、場上無兵，一次 combat update 後仍被判敗。不是自然玩到該裝備組合的紀錄 |
| E006 | 同上 `quickToolPointer`；[app.mjs:115](D:/Projects/YesSir/_Tools/fishing-quicktest/app.mjs:115) | 目前鏡頭投影後，快測舊公式把世界 (10,-3) 解回 (5.856,-1.185)，誤差 4.524 單位；公式還限制 ±7.3，場地已是 ±12.5 |
| E007 | [currency-quicktest-split.json](D:/Projects/YesSir/_Games/ashen-legion/tests/currency-quicktest-split.json) | seed 42 三策略首輪均未過關：劍兵時限敗北剩 1,754；槍兵 85.9 秒破產；騎兵時限敗北剩 23。槍兵未買到偏好裝備；非玩家勝率、非充分平衡樣本 |
| E008 | [main.luau:596](D:/Projects/YesSir/_Games/ashen-legion/main.luau:596)、[formal-ui.luau:85](D:/Projects/YesSir/_Games/ashen-legion/ui/formal-ui.luau:85)、[rewards.mjs:24](D:/Projects/YesSir/_Games/ashen-legion/presentation/rewards.mjs:24) | 大王最後 30 秒出現，大獎／特獎才完成該輪；小獎也會播放中央 coin-burst。這是實作規則，不推定真人感受 |

來源與置信度的機器格式見 [evidence-index.json](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/evidence-index.json)。

## 五個優先問題

| 優先級 | 問題／證據 | 影響 | 最小修正與驗收 |
| --- | --- | --- | --- |
| P1 · I001 | **還買得起槍兵，卻被判破產**。E005 | 配裝讓劍兵變貴後，錯誤切斷其他兵種的求生選擇 | 以全部可用兵種的最低派兵費判斷；46／20／40 且剩 20 必須保持戰鬥，真的全都買不起且沒有活兵才敗北。owner：YesSir Luau |
| P1 · I002 | **非疊加技能仍重複收費**。E004 | 槍兵已有旋轉，買同技能卻更貴；容易被誤認為槍兵數值差 | 購買／裝備預覽顯示實際增益差值；當前兵種已具備的非疊加技能不要列作優先核心商品。商品可移給別兵，應保留這個用途；不要直接讓所有重複技能疊加。驗收：同技能能明示「已有，無新增效果」，且推薦不再把它當有效強化。owner：YesSir Luau＋UI |
| P1 · I003 | **快測手動瞄準與正式場景不一致**。E006 | 機器直接送世界座標能通過，玩家在快測工具點畫面卻射偏，會污染手感與兵種判斷 | 快測共用目前遊戲的鏡頭／呈現座標與反算接口，移除舊常數；九點取樣、三種解析度，世界命中誤差 ≤0.25。owner：YesSir quicktest／presentation；通用 engine primitive 有必要才另提需求 |
| P2 · I004 | **戰鬥主目標不在視線內**。E003、E008；E007 只作風險補充 | 賺很多仍然輸是允許的規則，但玩家可能不知道最後 30 秒應轉向大王。這是理解風險，尚無真人誤解率 | HUD 加當前目標：備戰／大王倒數／大王大獎通關；保留玩家選定的 AUTO 篩選，不替玩家偷偷切換。新手 5 人中至少 4 人能復述，看到大王後能自行轉移瞄準。owner：YesSir UI |
| P2 · I005 | **小獎也使用大片中央演出**。E003、E008 | ×1.6 的光芒占了中央大片區域，大小獎視覺級差有被壓縮的風險；不能據單幀聲稱持續看不清 | 小獎保留噴幣／落地／回收，但亮點跟隨中獎怪與炮台；中央大型構圖留給 BIG／MEGA／LEGENDARY。驗收：固定怪物潮片段的目標追蹤成功率及小／大獎辨識；一次只改演出範圍。owner：YesSir presentation／Lottie |

I001–I003 是已重現的錯誤或工具偏差。I004–I005 是有畫面和規則依據、仍需真人驗證的體驗風險。本次完成檢視及重現，**以上問題尚未修改正式遊戲**。

## 核心循環與取捨

| 玩家動作 | 立即目標／資源 | 局內與長期承接 | 本次判斷 |
| --- | --- | --- | --- |
| 選景點、買裝備、研究、附魔 | 用有限結晶決定增益與未來派兵費 | 七輪逐步形成構築 | 拆分資源方向合理；須修 I002 才能避免無效購買 |
| 選兵、瞄準、按住發射、停火 | 用金幣押注射線、命中數及獎項 | 保留打大王的資金 | 有成本與落空風險；I001 不應剝奪仍可派出的便宜兵 |
| LOCK／AUTO、切小怪／王 | 集火或選擇賺錢目標 | 最後 30 秒轉向關卡目標 | 模式和目標入口已存在；缺少勝利條件提示 |
| 反彈、穿透、範圍技能 | 讓同一支部隊產生更多有效接觸 | 裝備／科技改變射擊策略 | 組合資料結構已有基礎；40 單位的基础劍兵行程與 25×25 場地需按射角檢查，不可宣稱任何射向都能彈兩次 |
| 成功開獎、結算、開箱、下一站 | 金幣、結晶、裝備 | 下一次選路與城鎮建設 | 規則有閉環；此次只操作開局，未用短樣本證明完整旅程體驗 |

不確定性包含：怪物移動與射線、隨機商品／附魔、破防後獎項、稀有事件。可學習的部分應讓玩家看見：為什麼這條射線命中更多、這件裝備增加了什麼、花掉多少派兵金幣。所有怪物仍可抽獎落空，這次建議不加入必中或保底。

應保留：固定炮台、25×25 正方形物理場地與玩家指定透視、三兵種成本差、金幣和結晶分工、局內／局外養成分離、局內七次選路、官方 Canvas UI、具體低模士兵與怪物。四人網路搶池是後續範圍，不能用四個底層金幣帳本當多人驗收。

## 畫面證據卡

![E002 武庫](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/images/gear.png)

**E002，靜態／操作事實信心高，理解效果未知。** 已穿戴、結晶扣款和派兵費變化都可見；但大片空白區沒有呈現角色或攻擊前後比較。可以用既有紙娃娃／動畫資產補一個「穿透 0→1，派兵 8→10」的短示範，先驗證玩家能否說出收益與代價；目前不把它列在上述三個正確性修復之前。

![E003 小獎與戰鬥 HUD](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/images/battle-auto.png)

**E003，畫面事實信心高，對注意力的影響為中等信心假設。** 普通 ×1.6 小獎有大片中央放射線，金幣與怪物仍可見；畫面沒有說明這一輪必須讓大王開大獎。優先用 I004 的目標提示測理解，再單獨測 I005 的演出級差；不要同時調獎率、怪物密度和畫面亮度，否則無法歸因。

## 快測安排與驗收

1. 先修 I001–I003，將這次重現改成期望正確行為的回歸測試；原本通過的守恆／排版測試仍保留。
2. 固定遊戲 source hash、策略 hash、城鎮等級、起始資源與種子，再跑九流派。先用 10 個共同 seed 做首輪診斷；再分開全新城鎮／已養成城鎮做完整七輪。記錄首獎、首個技能觸發、有效命中、各兵種花費／收入、Boss 抽獎次數、存活退款和失敗原因。
3. 機器策略需記錄「沒有買到有效裝備」與「改派劍兵」的次數。落地風環 seed 42 未買裝備，不能把該結果直接當完整槍兵流派表現。
4. I004 採一個小型真人理解測試，計畫已寫成 [ed-triage.json](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/ed-triage.json)。在已有原型上做一個 HUD 變因，不把它包裝成可預測留存的 A/B 結論。

**對 GameDesignOS 的使用評價：值得留下作設計檢視與驗收工具。** 它提供的價值是把發現連到證據、限制推論、指定下一個有用測試；真正的規則驗證仍由 Unone Luau／WASM 和遊戲自己的快測執行。這次沒有啟用它的外部模型 host、全域同步或 Python runtime。

可重現工具：`node _Tools/design-review/probe.mjs`、`node _Tools/design-review/capture.cjs`；資料生成為 `node _Tools/design-review/write-report-data.mjs`，原版 schema 驗證為 `python _Tools/design-review/validate.py`。三份結構化輸出驗證結果見 [validation.json](D:/Projects/YesSir/docs/reviews/2026-09-11-gamedesignos/validation.json)。資料生成器是這次 review 的快照腳本，遊戲版本改變後應重新審視結論，不能只改時間戳或 hash 就沿用。
