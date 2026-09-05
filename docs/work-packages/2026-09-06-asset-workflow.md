# 資產工作流調整計畫

版本：v3 + code-review corrections / source_review_closed, build_blocked。
v1 保留於 `146baeb`；獨立限定再審
無 unresolved plan blocker，製作已放行，尚非功能驗收通過。

## 目標與取捨

讓只拿到引擎封裝的 AI 能回答：該改哪個檔案、會影響哪些已知引用、
目前 active 資產是否等於作者檔案、下一步如何發佈/驗證；不得靠清 cache 試運氣。
本輪是 developer tooling 與 bundle activation，不是 runtime AssetManager。

| 外部建議 | 判斷與處置 |
|---|---|
| 缺少編輯入口與來源權威 | 採納：增加可機讀的單筆資產工作流查詢，明確區分 authoring、pack、active |
| 新增/替換並同步所有引用 | 部分採納：替換同 id 的 source 不必改引用；新資產沿用已有 init 宣告。不能承諾找出任意 Luau 動態字串 |
| init 不生成實際圖片 | 不是缺陷：CLI/MCP 已明說只宣告。增強回傳的實際 changed_files 和後續入口，不憑空製作美術 |
| asset package/validate/verify 指令 | 不新增同義層：沿用 bundle pack、asset inspect --strict、game verify |
| source 更新看見舊內容 | 採納：提供 source/active hash 與宣告比較；完整 generation 一次啟用，修 roadmap #11 |
| asset rename/remove | 本輪不自動改寫/刪除：靜態無引用不等於無動態引用。穩定 id 替換為標準；真正 id migration 需另案 |
| --file 與 companion files | 採納 discoverability：逐一列出 primary/companion、用途邊界和可執行 argv。完整依賴由內容匯入器宣告，不猜外部格式 |
| 格式/尺寸/pivot/atlas/壓縮 | 分層：本輪如實列出驗證範圍，不制定任意 production 標準；pivot 已有 2D 中心契約。格式 cooker/import 留 roadmap #8 |
| native 真貼圖缺口 | 屬實且已在 roadmap #17，不把 rendering 工程塞進本輪 asset 操作工具 |
| 靜態無法抓 Luau 動態 id | 已有 static_reference_scope。保留並突出此限制，不聲稱 inspect 覆蓋 runtime |

## 單一有效契約

1. 作者內容：project config 指定 manifest；manifest 的 id/source/kind/bundle/files
   是宣告。source/files 是編輯內容的入口，scene 中同一 id 的使用只控制放置與表現。
2. 打包內容：bundle pack 由作者檔案產生 bundle manifest/hash/archive，不能手改
   archive 或 cache 代替修 source。pack 不自動啟用 generation。
3. 本地 active：install 明確啟用一份 generation；read 只讀符合當前 bundle
   manifest 和 active hash 的 verified bytes，不 fallback 作者 source。
4. Web 的 IndexedDB、native 的 .unone 是不同 host 儲存；本地 CLI 啟用不代表
   Web 也啟用。查詢只報告 native-local，其他 host 必須各自安裝與驗證。
5. 穩定 id 的圖像替換：改 source/files bytes，必要時改宣告的 source 路徑；
   不自動變更 scene size/pivot/碰撞體，也不需要掃描並改寫引用。

## A：單筆資產的唯讀工作流查詢

新增 `game asset describe --id <id> --json` 和同一 core 函式的
`unone_asset_describe` MCP。它是聚焦查詢，不複製 inspect 的全部 gate，
不改現有 inspect 的成功語意，也不讓每次 inspect 默默讀取所有資產 bytes。
CLI help、asset inspect/init 的回傳引導到此入口；未宣告 id 時列出可選 id，
不給虛構的命令或不存在的 asset add。

最小輸出：

- `project_root`, `asset`：已驗證的 manifest entry。
- `authoring`：manifest 的 project-relative path + JSON pointer `/assets/<index>`；
  primary 和每個 companion 的 path、role、exists、size_bytes、sha256（可讀才有）。
  每個 path 列出 manifest 中同樣使用它的 `shared_with_asset_ids`，包含作為別筆
  primary 或 companion 的情況；不把 selected asset 的 references 當成全體影響。
  `editing_rules` 說清改內容/改 path/改 scene 的差異，不能產生新美術。
- `references`：主場景檔案 path + JSON pointer `/entities/<index>/<component>/asset`、
  entity id、component。sprite/mesh3d/animation 都涵蓋，保留實際 array index。
- `reference_scope`：明確 main_scene only / dynamic Luau not inspected；不將
  unreferenced 當成可安全刪除，亦不搜字串假裝做過完整語意分析。
- `active`：scope=`native_local`、generation、每個檔案的 verified read
  size/hash 或 structured diagnostic；不把失敗壓成 missing/false。
- `publication`：scope=`selected_asset_native_local`、
  `matches_authoring: true | false | null` 和 reasons。
  只有 active asset-manifest 中的該筆完整 AssetSpec 與作者相同，且 primary +
  所有 companion bytes 的 verified hash 相同，才能 true。無有效 active/讀取
  損壞時為 null 並附原因；可驗證但 bytes/宣告不同時為 false。
  不能用「asset read 成功」「bundle hash 有值」冒充已發佈最新 authoring。
  這是單筆資產 freshness，不等於所有 bundle、整個遊戲或其他 host 都已同步。
  result.ok 僅指查詢完成；不把 matches=false/null 改成 true，也不稱為 release gate。
  current manifest 與 active 不相符時如實傳遞 mismatch，不承諾此版本能解析
  舊 generation 的全部內容，更不改 read 的權威去湊出可用結果。
- `required_next_actions`：有順序與原因的資料，命令以 executable=`game` +
  argv array 表示（帶 --project，argv 中 id/path 是單獨參數）。不得把任意
  id/path 拼成可注入 shell 字串。非機械編輯是需 AI 完成的內容步驟，不偽裝成命令。
  每個 file 還附明確 read argv；primary 不帶 --file，companion 帶其完整宣告 path。
  未就緒的後續步驟標示其 prerequisite，不把整串尚不能執行的動作都標成 ready。

後續命令的保守收斂路徑：補齊/修正作者檔案 → bundle pack → asset inspect
--strict → bundle install --all → asset describe（再次確認）→ asset read。
第一次新 bundle 尚未宣告時，不能把 strict 放在 pack 前造成永遠無法進步的循環。
matches_authoring=true 且沒有阻塞時不要求重新打包；不能建議清除整份 cache。
查詢本身不執行這些步驟、不寫檔，也不把 read.output 指回 source。

Code review 階段補入已重現的必要 guard：pack 的 generated manifest／archives
及其相關 staging output 不得與 authoring inputs 衝突，寫入前統一檢查。
例如 `--output assets/manifest.json` 不可因路徑在專案內就覆寫作者宣告。
此為來源權威的資料完整性保護，不新增匯入器或全域 IO transaction。

安全與錯誤：既有 portable source / symlink containment 規則必須同樣套用到
primary、companions、manifest 和讀取的 bundle source；不要藉查詢讀專案外 bytes。
抽取小型共用 project-relative resolver，先做 portable lexical 檢查，再檢查
現存目標/祖先的 canonical containment。套用於本工作流讀取的 asset/bundle
manifest、main scene、source/files 與 native local bundle fetch；strict inspect
和 pack 不得有 companion 檢查落差。不把這次工作擴張成全部 IO API 重寫。
明確指定的 `asset read --output` 是使用者授權的匯出路徑，不屬於作者來源
containment；describe 產生的 read argv 一律不附 output。MCP asset read 可寫
output，因此 readOnlyHint 修成 false；describe 才是 readOnlyHint=true。
重複 id / 無效 manifest / 不合法 path 要 fail closed。缺 source 時保留可用的
編輯定位和明確 blocker，不用虛構 hash。檔案修改的競態不承諾交易快照；
必要時標示觀測時間/一致性限制，下一次 describe 可重新確認。
不得從不同 generation 拼湊出 true；須固定同一份 active observation 或在查詢
前後檢查 generation/manifest token，有變更就回報 unknown/inconsistent。
此保證不等於對任意外部 source writer 的 filesystem transaction。
native 最新的正式 generation 檔（不含 .part）是唯一 active record；
最新檔無法讀取/解析時回傳 `BUNDLE_ACTIVE_GENERATION_UNREADABLE`，不靜默
回退舊 generation。read、inspect、describe 使用同一 loader；缺少 record 與
record 損壞是不同狀態。描述工具不可使用會吞錯的 Option-only API 假裝成功。
不新增 active pointer 檔或第二套權威；不承諾多個安裝 writer 的併發交易。

Code blind review 補強：`asset read` 回傳的 AssetSpec 與 verified bytes 必須
取自同一 active observation；先比對 authoring 與 active 宣告，不符即回傳
`BUNDLE_GENERATION_MISMATCH`，禁止把新 kind/files 配上舊 bytes。
觀測不一致／讀取失敗先於 export 寫入；describe 的 file-level failure 同時
進入去重的 active／top-level diagnostics，不能只靠深入 file 欄位找原因。

init 回傳 `changed_files`（實際本次寫入，不含未動的 source），並給 describe
入口；若原 init 的後續寫入失敗，已發生的寫入仍須出現在 failure effects，不宣稱
跨檔案交易或零副作用。不得新增第二套 asset spec 驗證規則。MCP asset init 的 kind enum 目前
漏了已支援的 spine/effekseer，本輪同步，避免輸出流程無法經 MCP 執行。

## B：完整 generation 一次啟用

沿用 `bundle install <id>` 的子集行為，新增互斥選项 `bundle install --all`
及 MCP 對等參數。必須恰好選 id 或 all，不能默認擴大為所有 bundle。
CLI positional id 改為 Option<String>，all 為 bool；CLI/MCP 都經相同 core
選擇驗證（id-only/all-only 成功，none/both 拒絕），help/schema 同步表達。

所有 manifest roots 共用同一 installed set 和 dependency traversal；所有選中
bundles 驗證完畢後只寫一次 active generation，不能逐 id 調用 install。
任一 fetch/hash/dependency failure 不切換 active；已驗證的 cache 檔案可以留下，
並非整個磁碟 transaction。空或重複 id 的 manifest 拒絕啟用，不產生空 generation。
「空」包括 bundles=[] 及空白/空字串 id。native id/all 與 Web install 都拒絕
空集合、空/重複 id、無效 hash/size、缺失/循環依賴；跨 host 使用同一組有效/
無效 fixture 定義最低共同契約，JS 不透過複製整套 native installer 實現。
既有 Web normalizeManifest 補缺漏即可。檢查先於 active 寫入，失敗保持原
active metadata；作者 bundle manifest 已被 pack 更新時，不承諾舊內容仍
符合新 manifest 可讀，這不是整個發佈流程的 rollback。
不新增下載器、不加自動清 cache、不改既有分包選擇語意；文件清楚區分 subset/all。

Code review 限定補強：缺少 bundles 欄位兩 host 均視為 INVALID；明示 [] 為
EMPTY。Web read 與 install 同樣檢查完整 graph；已有 active pointer 但 record
缺失／無效，明確 UNREADABLE，不當 first install。Native install 的 report
可失敗檢查須先於 active 寫入，不能已啟用後才回報不含 effects 的 failure。
不採納自動 union 舊 active entries；獨立 reviewer 已依现行契約撤回該建議。

## C：刪除被取代的規格

使用者明確要求舊規格直接移除。落地後以 `docs/asset-workflow.md` 為唯一現行
資產操作/權威契約。移除被取代的 Decision 0024/0026 檔案並更新所有 current
docs/packaging links；未被取代的引擎責任邊界移入新契約，不跟著丟掉。
Decision 0025 的一般盲測/嚴格 gate 原則未全部被取代，保留並修正引用。
其中只列 texture2d/mesh3d 的過期 kind 文字也必須清除，以 core 支援集合為準。
同步 ai-workflow、ai-agent-game-handoff、MCP/help、pack-ai-engine；新 package
只帶現行資產規格。Git 保留歷史，不另留 obsolete spec 副本或 deprecated aliases。
既有不可變 package 為歷史驗證輸入，不直接覆写；本輪產出新封裝。

## 審查、製作、盲驗與接受標準

1. 主代理先寫本計畫。全新 Luna/max plan reviewer 不繼承主對話，不看外部建議
   的作者身分或主代理的口頭結論；只讀計畫與現有 repo 契約，回報反例與缺漏。
2. 逐項接受/駁回有證據的 findings，改計畫後請 reviewer 再驗證；重大規格
   選擇才問使用者。不能要求 reviewer 為「零問題」背書或隱藏仍有爭議的項目。
3. 無 unresolved blocking finding 後，Luna/max 製作；主代理不寫功能程式。
   B 和 A 可分 worker，但共用 bundle API/CLI/MCP 必須有單一 owner 依序整合。
4. 主代理查 diff、執行必要 tests；另一個全新 reviewer 獨立審 code。Claude
   review 仍定期做；已排的 #29 只 review 固定旧提交，不混入本輪。
5. 以已測試提交重新 build CLI/wasm/mobile 與 immutable package。全新 blind
   evaluator 只得到 package、資產維護任務企劃、空輸出目錄；不得讀 engine source、
   本計畫、前面 review 或其他遊戲。任務自行產生簡單 SVG 等 bytes，不需 AI 畫圖。
6. 盲驗至少包含：建立兩個 content bundle；替換同 id source；搬移 source 路徑
   但保留 id；新增/修改 companion；辨識尚未發布；依工具指引發佈；三次確認 read
   hash 對應新 bytes、references 無不必要改動、all generation 完整、錯誤不汙染
   active；正確回答動態引用與 host rendering 未被驗證。保留首次卡點，不教測試答案。
7. 回歸：read-only filesystem before/after；有空白與特殊字元 path/id 的 argv；
   JSON pointer 真能定位；primary/companion 的缺漏與越界/symlink；metadata-only
   變更不誤判 fresh；active 缺失/落後/損壞；all success/failure/cycle/duplicate/empty；
   CLI/MCP 同契約；舊資產規格與失效連結已移除。
   額外回歸：同 source 被不同 id 共用、generation 2 損壞不得退回有效的 1、
   查詢期間 generation 改變不得 fresh=true、Web 拒絕空/重複 id 與空集合。
8. blind feedback 若需修正，回到明確問題與再測，不以縮小原接受標準當作通過。
   最終只可稱本輪 workflow gate 通過，不改七款總驗收或宣稱 native 貼圖已完成。

## 磁碟決策後的接續點

目前所有製作者的修正候選已交付；Bundle/Web 與 asset/preview 的限定
source-only 覆核皆已完成，未見新增可證實 P1/P2。主代理已做 Rust 語法解析、diff check 與
Node 5/5（stub）驗證；不把這些稱為 Rust 編譯、Wasm 或 real-browser 通過。

1. 等使用者回覆是否清理唯一指定的 `target/debug/incremental`，不可把
   async 選項預選視為授權。詳見 disk-pressure issue。沒有自行清 cache。
2. 若獲准，重新確認 exact target／沒有 active Cargo-rustc-link，再只清
   該可重建快取並記錄前後磁碟量；不可刪 Games、`.git`、其他 target 或舊封裝。
3. 依序重跑 workspace tests（明示 Windows link privilege skip）、clippy、
   CLI build、MCP smoke。用主代理保留的原 probe 重跑 corrupt generation、
   metadata mismatch、output collision、post-activation Junction 反例。
   Corrupt-generation／Junction fixture 保持原狀；output 覆寫案保留修前證據，
   從已記錄的原始 authoring 輸入重建隔離樣本，再確認失敗前後完全未改檔。
   不以修好損壞 active record、清 cache 或跳過案例來掩蓋修正前後差異。
4. 凍結已驗證 commit，重新 build wasm/mobile，再產生全新的 immutable package，
   檢查 source_commit／source_dirty／inventory hash，不用舊平台 binary 冒充。
5. 全新 Luna/max evaluator 只拿 package、本驗證企劃與空目錄；保留首次 blocker，
   然後用實際 browser/host 補必要畫面與截圖。七款 final gates 維持原狀。
