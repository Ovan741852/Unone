# AI 資產維護：從第三方建議到可驗證工作流

日期：2026-09-06。狀態：code_review_in_progress；新封裝暫待磁碟空間決策。

## 決定做什麼、為什麼

第三方指出 AI 必須自行拼湊資產編輯、打包與啟用流程。主代理以目前程式為準，
沒有把建議中的全部命令照單全收：穩定 id 換 source 不必改 scene 引用；
`asset init` 只宣告、不產生美術是既定且合理的責任邊界；任意 Luau 動態字串
不能靠靜態掃描保證 rename/remove 安全。因此本輪不做全域 rename/remove、
同義 package/validate 指令、格式 cooker、native renderer 或 runtime AssetManager。

採取最小切片：唯讀 `asset describe`、完整 `bundle install --all`、既有 init
與 CLI/MCP 的回饋一致性，以及單一有效文件。詳見[工作包](../work-packages/2026-09-06-asset-workflow.md)。

## 問題按影響範圍處理

| 問題 | 判斷 | 解法與邊界 |
|---|---|---|
| 不知編輯檔案、引用影響、發佈狀態 | 開發工具的契約缺口 | 結構化 facts / argv；source 共用關係與靜態 scope 如實呈現，不推測遊戲語意 |
| 安裝單包取代整個 generation | BundleManager 的啟用單位問題 | all roots 共用 traversal、驗證後一次啟用，不在 CLI 迴圈呼叫單包 install |
| 最新 active 壞掉卻讀回舊代 | 共用 active loader 的權威問題 | 集中 fail-closed；不讓每個呼叫者各自發明 fallback |
| companion/manifest 路徑檢查不一致 | 跨資產讀取路徑的安全問題 | 小型共用 resolver，套用同一 containment 規則；不重寫不相關 IO |
| MCP readOnlyHint 與 kind 枚舉錯誤 | 工具 metadata 邏輯／文件問題 | 修正現有定義，不新增同義 API |
| 舊規格與教學矛盾 | 文件權威問題 | 刪除被取代的 0024/0026，更新引用與新 package；Git 保存歷史，不留 deprecated stub |

## 獨立審查與分工

- v1：`146baeb`。Luna/max Hubble 未繼承主對話，獨立只讀計畫與程式。
- 第一輪五項 findings 逐項核對；v3 再審未發現 unresolved plan blocker，
  `04af786` 保存處置。這是製作放行，不是 code／產品通過。
- [審查紀錄](../reviews/2026-09-06-asset-workflow-plan.md)保留理由與審查範圍。
- Euclid（Luna/max）：bundle / resolver / Web validation。
- Heisenberg（Luna/max）：資產工作流 core / init 回饋。
- Parfit（Luna/max）：CLI / MCP / 現行文件 / packaging。
- 主代理：規劃、整合與驗收；功能完成後另派全新 code reviewer 與 package-only
  evaluator，後者只拿不可變封裝、維護任務與空輸出目錄。

## 驗證進度

製作前 `cargo test --workspace`：100 passed（CLI 6、engine 82、mobile 8、Web ABI 4）。
功能回歸、全新 binary/wasm/mobile build、不可變 package 與盲驗尚待完成。
主代理已用獨立暫存專案重現：連續安裝兩代後破壞最新 generation 2 JSON，
舊 CLI 卻 `ok=true` 並讀回 generation 1，見[修正前證據](../evidence/2026-09-06-asset-workflow/generation-corruption-before.json)。
修正後必須對原樣本 fail closed，而不是重新初始化樣本掩蓋問題。
候選 CLI 已對原樣本回報 `BUNDLE_ACTIVE_GENERATION_UNREADABLE`，不讀舊代；
失敗 install 前後最新 active record hash 均為
`fe7f9c36c004d540147652629f8aa958734d10ffb687e0aa08cc6dd3cf63decc`。
同原因重複三次的 describe 雜訊已由 owner 移除，`4a128d7` CLI 再測確認每份
diagnostics collection 僅一項；affected file 仍保留該結構化原因，
見[候選修正後證據](../evidence/2026-09-06-asset-workflow/generation-corruption-after.json)。

其他主代理候選驗證：

- [發佈階段](../evidence/2026-09-06-asset-workflow/publication-stages.json)：初版
  true → source 修改 false → pack 未啟用 null → all 啟用 true；read hash 與
  PowerShell `Get-FileHash` 相同，scene hash 未改。
- describe 前後 15 個 project 檔案的 path/size/hash/last-write time 相同；
  直接以 argument list 執行回傳 argv 成功。
- [CLI/MCP parity](../evidence/2026-09-06-asset-workflow/mcp-parity.json)：同一
  project/id 的完整 describe JSON 相同，MCP read hash 也相同。
- [真實 Windows Junction](../evidence/2026-09-06-asset-workflow/junction-containment.json)：
  primary 在專案內、companion 經 junction 指向外部測試目錄；strict、describe、
  pack 都明確拒絕。SymbolicLink 建立因需管理員權限失敗，不把相關 skip 說成
  symlink 已實測。
- 中途整合 workspace tests 117 passed、Web JS validation unit 3 passed。
  這是 checkpoint；最終 code freeze 仍須重新測試。

主代理整合回饋已涵蓋：dangling link 不得當普通缺檔、MCP all:false schema
一致性、selected references 過濾、避免重讀 companion archive/複製 bytes、
空 init 不給虛構 argv、corrupt record 與普通 cache 過期的恢復流程分開、
metadata-only 測試要在 pack 前驗證真正 AssetSpec 比較。
另刪除從 authoring config 推測的 active manifest path：作者改過 manifest
位置時，該值不能代表 active 內容的來源；只保留真正在 verified
`asset-manifest` bundle 內解析到的 JSON pointer。
本輪尚無新畫面驗證；不得用先前截圖冒充本輪證據。稍後的 CLI 資產驗證也不能
當作 native 貼圖渲染或 Web storage 已同步的證據。

Claude #29 已排程補審固定 `6ab9b60`，與本輪範圍分開。本輪完成切片仍依
[review 流程](../review-process.md)安排獨立 code review。

七款正式遊戲 final gate 未變，不會因資產工具通過就改成 passed。

## Code freeze 前後的後續驗證

三位製作者已交付，另由未繼承對話的 Gauss（A/C）與 Lagrange（B/Web）
獨立審查已完成的切片，不讀主代理的計畫處置／證據／舊 review。

workspace tests 回報 121 successes（CLI 9、engine 100、mobile 8、Web ABI 4）；
其中 Windows dangling symlink setup 明示因 os error 1314 跳過，不計作真
symlink 覆蓋。主代理另實跑的 Junction 檢查見前述證據。clippy -D warnings
已通過；AngryBirds2D verify 仍為 6/6 gates passed，Games working tree 未改。

封裝前重建遇到 linker PDB 失敗，單獨重試 CLI build 成功，但 D 槽只餘約
0.27 GB，後續平台 build/package 未放行。已詢問是否只清理可重建增量快取，
詳見[環境問題紀錄](../issues/2026-09-06-build-disk-pressure.md)。

Claude CLI 2.1.260 的 [review #30](../issues/2026-09-06-claude-cli-review-30.md)
已完成固定 `04af786..4a128d7` 只讀審查，回報無 actionable P1/P2；未執行測試，
不取代盲驗，也不抵銷 #29。主代理另外用小型 probe 發現
[pack output 能覆寫 authoring asset manifest](../issues/2026-09-06-asset-pack-output-collision.md)，
已交原 owner 做寫入前 guard 和回歸，不能因 review 無 finding 就忽略實際反例。

Gauss 的[獨立 code review](../reviews/2026-09-06-asset-workflow-code.md)第一版
提出 read 混用 metadata/bytes 與 file 錯誤未進頂層 diagnostics；主代理重現／
核對後採納，交 Heisenberg 修正。這些是共用引擎資料與診斷契約問題，不要求
範例遊戲自行判斷或包一層 workaround。完整回歸仍受磁碟空間決策限制。

Lagrange 第一版五項：主代理不接受自動 union 已安裝包（會改變明確 subset
語意），reviewer 核對 current contract 後撤回。接受缺欄位診斷一致性的小修、
Web graph/read 與 corrupt pointer guard、native activation/report 順序修正。
後者主代理以真 Windows Junction 重現「exit 1、effects 空、卻已新增一代」，
證據與逐項理由均在 code review 紀錄。Bacon 另以 Luna/max 製作 Web 限定切片。
