# Asset workflow 獨立 code review

日期：2026-09-06。固定候選：`04af786..4a128d7`。
狀態：findings_under_repair；尚未放行新封裝。

Reviewer 為未繼承主對話的 Luna/max：Gauss 審 asset/CLI/MCP/current docs/packaging，
Lagrange 審 bundle/path/Web validation。不得讀前次計畫審查與主代理證據，
只能以候選程式、必要契約與自建小型 probe 查驗。磁碟不足時不 build。

## Gauss：兩項，主代理採納

1. P1 `asset::read` 回報 authoring `AssetSpec` 卻讀 active bytes。
   只改 authoring kind、不 pack，read 就成功回傳新 kind 配舊 bytes；
   describe 同時正確顯示 active 舊 kind / spec_matches=false。
   主代理另於自己的 positive probe 重現，見
   [反例](../evidence/2026-09-06-asset-workflow/metadata-mismatch-before.json)。
   修正：從 verified active asset-manifest 找到同 id 並比較完整 AssetSpec；
   宣告不同就明確 mismatch，不混用不同權威。固定同一 observation，
   generation/metadata/bytes 不得跨代組合；失敗須先於 export 寫入。
2. P2 `asset_workflow::read_active_state` 把 content read 錯誤僅放進
   `active.files[].diagnostic`，沒有提升到 active 與頂層 diagnostics。
   cache miss 時一般 client 看不到標準 blocker。核對失敗 branch 屬實；
   修正為既有 diagnostic collector 去重收集，保留逐 file 的定位。

原 owner Heisenberg 製作修正與回歸；不由 reviewer 自己實作再自行宣告通過。
第一項應核對 baseline 區分既有問題；即使既有仍直接違反本轮 read contract，
不以「不是這次引入」為由保留混合 metadata。

Gauss 未重跑完整 package/MCP smoke；未另提出 CLI/MCP dispatch、describe
readonly 或 argv 的 P1/P2。這不是對未測平台或無限輸入的零問題保證。

## Lagrange：五項，四項處理、一項撤回

1. 不採納「subset 應累加先前 active entries」。現行契約只啟用選中 id 的
   dependency closure，`--all` 才代表完整集合。自動 union 會讓同一指令的結果
   依先前 host 狀態改變；不是修 bug，而是改選擇語意。主代理要求契約依據後，
   reviewer 明確表示無反對依據並撤回此 finding。補清楚文件，不改引擎行為。
2. 缺少 `bundles`：Rust 因 default 當空陣列、Web 當格式錯誤。兩者均拒絕，
   所以主代理下調為低嚴重度 diagnostic parity，不是漏放無效 manifest。
   採納小修：required array；缺欄位 INVALID，明示 `[]` EMPTY，加入共同 fixture。
3. 採納：Web `readActiveBundle` 僅驗證 manifest 外形，未驗證完整 dependency
   graph；native 已全面檢查。同一有 unrelated missing/cycle 的 manifest 不該
   跨 host 一邊可讀一邊拒絕。讀取與安裝共用 graph validation。
4. 採納：Web active pointer 存在但 record 缺失時，被當成 first install 並
   寫 generation 1。必須與真正無 pointer 分開；invalid pointer／record
   明確 fail closed，不覆寫 pointer、不清 cache、不新增第二個 active pointer。
5. 採納：native `write_generation` 後才 `inspect`，未選中 bundle 的 cache path
   越界可讓已啟用的操作回 ok=false 且 effects 為空。主代理核對控制流成立。
   report 所需的可失敗檢查移到 activation 前，使用該次 validated observation
   產生結果；不能事後吞掉 inspect 錯誤或假裝沒寫過 active。

Euclid 處理 native 2/5 與主代理 output-collision；Bacon 處理 Web 3/4 與
shared fixture（Luna/max，明確分離 write sets）。Reviewer 的 Web 反例使用
in-memory stub，不是 real IndexedDB／Wasm 測試。主代理另用真實 Windows
directory Junction 獨立重現 native finding 5：重裝 a 回 exit 1 /
`BUNDLE_STORAGE_PATH_UNSAFE`、effects=[]，但 active 已新增 generation 2，
見[實測證據](../evidence/2026-09-06-asset-workflow/post-activation-failure-before.json)。
僅使用自行產生的 project／外部 sentinel 目錄；原 fixture 保留供修後再測。

## 其他審查與主代理發現

Claude [#30](../issues/2026-09-06-claude-cli-review-30.md) 已完成固定候選的
定期 source review，無 actionable P1/P2；其閱讀包含主代理 evidence，
與隔離的 code review／package-only 盲驗分開記錄。
主代理另重現 [pack output/source collision](../issues/2026-09-06-asset-pack-output-collision.md)，
由原 bundle owner 修正；沒有在 reviewer 第一版前提供該反例。

所有修正後須重新測試、限定覆核，再決定是否產生新不可變封裝與 package-only
盲驗。本文件不把任何尚在製作的 patch 記為 passed。
