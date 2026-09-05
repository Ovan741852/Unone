# Roadmap 執行計畫

日期：2026-09-06。規劃基準：`master` / `d7cae90`。

`roadmap.md` 是需求與優先級來源；本文件定義工作包、依賴、分工與驗收，
不把 roadmap 的提案文字當成已實作事實。七款總驗收仍以
`D:/Projects/Unone_Games/validation/acceptance-matrix.json` 為準。

## 本輪使用者指示

- 主代理負責規劃、拆工作、協調、審閱、驗收和本地提交；功能程式由子代理製作。
- 製作子代理固定使用 `gpt-5.6-luna`、reasoning effort `max`。
- 有問題必須問使用者。子代理先立即回報主代理；主代理整理事實、影響、
  選項與建議後詢問使用者。受影響的工作等待答覆，不以逾時或沉默當同意。
- 直接在 `master` 開發；不建立分支或 worktree，不 push。
- 每個子代理擁有明確可寫檔案。共用 core、schema、host 或 build resource
  的工作依序進行，避免兩位代理同時改同一契約。

## 工作包與順序

保留 roadmap 編號，依實際依賴切成以下批次。每批只派目前可驗證的範圍；
完成前一批不代表後面的平台能力或七款遊戲已通過。

| 批次 | Roadmap 項目 | 交付與依賴 | 驗收重點 |
|---|---|---|---|
| A：2D 表現 | #2 rotation/scale、#3 sprite layer | 同一工作包處理 world、Luau、schema、已有 2D host；碰撞關係先問使用者 | 固定單位/方向/pivot、穩定排序、replay/reload、跨 host 顯示；憤怒鳥或魚機驗證 |
| A 的獨立工具工作 | #14 Web observations/digest | 公開同一 frame 的引擎語意資料；不能另造 JS hash 規則 | load/tick/reload 可觀測、digest 定義相同、無 GPU 可讀 |
| B：音訊 | #1 | 先定 play/stop/handle/音量/loop/停止時機與 reload 契約，再接 audio asset 與 host | 語意狀態可重播；host 真正播放/停止有證據，缺少 host 不可標完整支援 |
| C：完整交接工具 | #11 generation install、#12 API discovery、#13 parity、#15 world preview | 完整 generation、可採取行動的診斷與 API 列表，作為之後盲測的共同入口 | 一次啟用完整 generation、失敗保留有效版本、相同 replay 的 host 比對、世界視野可檢查 |
| D：時間與場景 | #4 timer/tween、#5 scene load | 先定 fixed-frame timer，tween 是否另需工作包依實證；scene 狀態/save/cleanup 需明確決策 | 到期順序、取消、reload 清理；場景切換失敗可回復，沒有殘留 entity/UI/timer |
| E：物理查詢 | #6 raycast/overlap、#7 sensor、#9 非圓碰撞 | 先使用已宣告形狀做查詢/sensor；AABB/線段的需求由遊戲驗證再接入 | 排序穩定、sensor 不解算、contact 規則一致、錯誤輸入可診斷 |
| F：內容與輸入 | #8 import pipeline、#10 多點觸控 | 外部格式轉為既有 scene/asset；pointer id 與 replay 契約 | 產物走同一 verify；取消/遺失 pointer 不殘留；手勢與內容語意留遊戲 |
| G：平台完整度 | #16 native UI、#17 native texture、#18 native/mobile 表現、#19 iOS | 在相應 core 契約穩定後逐平台實作；優先補前述驗證實際卡住的 host | 同一內容真正呈現、生命週期/輸入/save；實機或模擬器證據，跨編譯不代替執行 |
| H：正式內容更新 | #20 串流/CDN/quota，加上既有熱更/分包驗證 | 分包依賴、限流/取消/重試、staging/activation/rollback、舊 generation 回收 | 中斷/壞包/容量不足/恢復；實測峰值記憶體與磁碟，不宣稱無證據的容量保證 |

#13、#16–20 如成為前一批的真實 blocker，提出影響與調序建議並詢問使用者，
不一面承諾跨平台完成、一面把必要平台工作排到驗收之後。

## 首輪已指派與待定

| 工作 | 角色與模型 | 可寫範圍 | 狀態 |
|---|---|---|---|
| #14 Web 語意顯示 | 製作：Luna / max | runner main/index、Web ABI snapshot envelope、專屬 regression 與 devlog | 已指派；待回報 |
| #2/#3 契約準備 | 製作：Luna / max | `docs/work-packages/2026-09-06-2d-transform-layer.md` | 已指派文件；production code 等使用者決策 |
| 分工/依賴/問題彙整 | 主代理 | 本計畫、交接規則與開發紀錄 | 進行中 |

待使用者決定：2D rotation/scale 是否只影響顯示、碰撞體由獨立參數設定，
或也改變碰撞體。目前只有圓形碰撞體，非等比縮放不能假設仍是同一個圓。
決策前不實作依賴這個選擇的行為。

## 每個工作包的固定交付

1. 契約：資料、Luau 型別、CLI/MCP discoverability、錯誤原因、範圍與限制一致。
2. 實作：Luna / max 子代理在指定檔案完成；提供變更清單與回歸結果。
3. 引擎驗收：主代理審查受影響契約，執行必要檢查；定期以 Claude CLI 唯讀 review。
4. 平台驗收：列出每個 host 的實測結果；core 語意、host 實作與 package 發行分別記錄。
5. 打包：相同 revision 的 CLI/wasm/mobile 產物、型別與文件，驗證 manifest。
6. 遊戲盲測：另派 Luna / max，只給不可變 engine package、一份 GAME_PLAN.md、
   空遊戲目錄。不得讓引擎製作代理兼任同一功能的首次獨立盲測。
7. 回饋：記錄首次問題、原因、使用者決策、修正位置和 regression；失效的操作指引更新乾淨，
   原始失敗 evidence 留在歷史紀錄且標註狀態。
8. 日誌：保存可重跑命令、實際結果及必要截圖；截圖只證明看到的內容，不代替狀態測試。
9. 提交：由主代理確認工作範圍後在 master 做本地 commit。package 發行以已驗證提交為基準。

## 問題回報與暫停

子代理遇到契約缺口、文件與工具矛盾、非預期失敗、無法驗證的平台、需要擴大
寫檔範圍或新增依賴時，立即回報：

```text
[BLOCKER] <id>
事實與重現：<命令、結果、版本、檔案位置>
分類：game-logic / engine-contract / architecture / docs-tooling / host
影響：<哪些工作暫停、哪些可獨立繼續>
選項與建議：<具體行為與取捨>
需要使用者決定：<一個明確問題>
```

主代理在使用者回答之前只繼續不依賴該問題的工作；不以自行增加 fallback、
降低 gate 或改寫企劃來當成解決。已確認的決策不重複詢問。

## 完成定義

工作包依序記錄：`planned` → `implementing` → `awaiting_review` →
`engine_verified` → `host_verified` → `blind_verified`。
如有 blocker，記錄阻塞原因、時間、待決問題，保留各階段的實際完成狀態。

主代理在所有必要證據齊全後才更新七款 final gate。一次單元測試、native verify、
畫面截圖或某款盲測成功，都不能單獨把整體引擎判為通過。
