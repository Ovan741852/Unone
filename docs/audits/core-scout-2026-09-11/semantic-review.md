# Core audit informed semantic review

結論：以草案明確聲明的「既有 Windows x64 executable、隔離 starter／公開 memory fixture、headless CLI/session 代表工作流」範圍，85.5/100 的十題分配有語義支持，沒有必須降分的項目。需修正下面兩處容易外推的措辭，再把結論交由最後機器驗證產物確認；本審核不等於整個 Core、商用成熟度或跨平台認證。

## 角色與依據

我是先前執行首次公開操作的 agent。初次報告封存後，root 才明確授權我閱讀 rubric、評分草案與兩份後續 capture，切換成 informed semantic reviewer。因此這不是新的盲測，也不是另一個全新作者對我自己 probe 實作的独立程式碼審查。對 root 的評分草案是在看到分數後做的證據審查，不重新標記初次試驗。

依照 `plugins/org.unone.ai-native/skills/unone-ai-native-audit/SKILL.md`，使用公開 recommend → describe ai_native.evaluate、catalog、init，並閱讀 `docs/report.md`。固定 rubric v1.0.0 的 4 分錨點是「公開契約下獨立完成，含負例修正、結果驗證及相關邊界」；它要求代表案例的證據，並不要求每個子系統或所有失敗模式全部通過。這也不允許用小案例推導未測平台/安全/型別能力。

閱讀的受評草案是 `docs/audits/core-scout-2026-09-11/README.md`，SHA-256 `d4b5f709fcc2c9a56eda197120013609d74810f84c4b185a2be58b29bc371829`。

檢查真實 execution capture 的 metadata、selected CLI outputs、22 對 session request/response，以及 memory scenario 的 mismatch、完整 memory samples/trends/unavailable/限制、profile 相關欄位與 fingerprints。大型輸出的工具顯示截斷處已以具體欄位重新讀取；不把終端顯示截斷當成 recorder outputTruncated。

- `session.capture.json` SHA-256 `9de51784ab963f11764ec6f8669daf0f70cd37048b295b220c815d89d9f9846b`：exit0、timedOut=false、outputTruncated=false、sourceChanged=false、30 operations、22 requests、normalTransportExitCode0、verifyNotReplayed=true。
- `memory-discovery.capture.json` SHA-256 `52b9b97ab9e0f8a0e073d6e0f22113985e884ff99c5da14f875ce6f115f6d659`：exit0、timedOut=false、outputTruncated=false、sourceChanged=false；11 個外層 subprocess 加公開 helper 的 1 個 nested fingerprint。
- 2026-09-11T11:59:30Z 對兩 capture 的 subject/probe 共26個引用重新做 SHA-256，比對均一致。另直接 hash 現有 `target/release/game.exe`，仍為 `6af56a589c4a39d3f16e176cfb2fc817ef7fcbbe7836e160c516973e86cc8c8e`。
- 補讀凍結的公開 `subject/docs/diagnostics-replay.md`，特別確認 warmup 只排除 retention trend，以及 early-exit `ticksExecuted:null` 代表未提供值。

沒有讀 Core Rust/JS 實作，沒有執行 audit 文件中的命令或再次執行產品 probe，沒有修改 repo 或封存的初次報告。上述 plugin CLI 僅用來讀 rubric/契約與空模板。

## 必須修正的措辭（不改變目前建議分數）

1. **Performance 的 warmup exclusion 需限定到 retention trend。** memory capture 有4個 full-GC samples，其中 tick10 的第一個 `warmup=true`；trend 的 `samples=3`。同一 capture 的 profile/VM `tick_count=40`，仍含這40 ticks。草案表格的「warmup excluded」單獨看會讓人以為全部 phase/profile timing 都排除暖機。請改成「4個 explicit full-GC samples；retention trend 排除1個 warmup sample（profile/VM仍涵蓋40 ticks）」。
2. **`ticksExecuted:null` 不可當作測得的0。** mismatch 真實回應為 status=incompatible、`fingerprintDifferences` 指向 `/engine/coreRevision`、adapter/performance/memory/ticksExecuted 皆 null。它支持「指紋不符被拒且沒有回報 replay 執行成果」。公開契約說 early exit 的未提供欄位用 null，不是 fabricated zero。請把「before executing ticks (`ticksExecuted:null`)」改為「以 incompatible 早退並回 actual/expected 指紋；ticks/adapter/performance 未提供，ticksExecuted 為 null」。若另要宣稱從未執行任何 Game.start/update 副作用，需專門的可觀察負例；這一份沒有做。

另有兩個建議補充：performance capture 只有1個 function stack sample，能證明 profiler 回報入口可用，不能定位可靠的函式瓶頸；`sustained_fps` 和 phase timings 都在 headless scope，草案已有相關限制，最終 answer 也应維持。這個 memory fixture 有固定配置/釋放行為和 full-GC sampling，不能轉寫成 YesSir、一般遊戲或 leak-free 證明。

## 十題逐項判斷

| 題目 | 草案分數 | 審核判斷與界線 |
|---|---:|---|
| purpose | 3/4 | 支持。README→workflow/session→init 的公開路徑實際可走；空目錄 capabilities-first 缺 config 是真實首次順序落差。不能用 deliberate framse 當自然 wrong guess。3分保留了此摩擦。 |
| capabilities | 3/4 | 支持。platform 有 compiled/project/host/renderer scope，schema/API search 不需 source。19個 move matches和 diagnostics 搜尋 no-match 是實際摩擦；沒有把 no-match 當成 runtime 沒能力。表列 systems 為 binary 自述，不是逐項 host 驗證。 |
| operation | 4/4 | 在所聲明的 input/edit/observe/replay 代表任務內支持。P03錯欄位→P04修復、P10/P11 dry-run不改狀態→P12 commit→P13 Luau input接續均有 public response。完整 `verify` 的 types gate 未過，所以不得把此4分稱作完整 author/export/release pipeline 通過。草案已有此明確排除。 |
| context | 3/4 | 支持。session/entity/revision/frame/script digest，加 memory scenario executable/game/assets fingerprints，足以保存本任務上下文。HEAD不是binary身分，asset hash不是renderer dependency graph；草案對既有build來源未作attestation。需求追蹤不應硬塞入Core。 |
| observation | 4/4 | 支持。P06/P11/P17快照、P08/P09分頁、before/after pointer diff、frame與revision、replay identical且原session不變都直接可核對。這是semantic state、非像素或人類視覺驗收。 |
| diagnostics | 3/4 | 支持。unknown field列允許欄位；revision conflict有actual/expected；session mismatch有修復方向；memory mismatch列實際/預期fingerprint，改用原始合法request後重跑成功。若干facts/suggested_actions空、缺analyzer沒有在此任務修好，3分合理。 |
| recovery | 4/4 | 支持本次相關邊界：原样stale request被拒且P06無double tick；watch用next_cursor續頁；close/open安全回到authoring初態。這不是request-id去重快取，沒有故意丟掉transport response，也沒測crash、跨process續接、journal overflow或任意timeout後復原。最終answer不能略去這些限制。固定rubric並不要求以未宣稱的所有恢復模式抹掉已完成代表案例的4分。 |
| boundaries | 4/4 | 支持所選authoring/runtime scope。init確實拒絕非空root，dry-run無commit，舊session確實拒絕，五檔hash不變；都有負例及其後状態驗證。這不建立OS sandbox、任意path traversal防禦、敵意plugin隔離或跨帳號權限。 |
| performance | 3/4 | 支持修訂後的限定主張。實際提供headless phases、heap、allocation/incremental-GC窗口、4個explicit full-GC samples、3個non-warmup retention樣本與unavailable null。沒有benchmark或可靠bottleneck attribution，且1個stack sample不足提升為此方面的強證明。見上面的warmup修正。 |
| reproducibility | 3/4 | 支持。四個accepted commands重播identical、原session不变、samebinary/game/script指紋、錯target被拒後使用未改的原始valid capture重跑、fixture hashes與recorder實體保存都存在。沒有clean-build provenance、另一binary/平台、compatible-version、checkpoint或migration驗證；3分合理。 |

十題 points 為 7.5+7.5+12+7.5+10+10.5+10+10+5.25+5.25 = **85.5**。這是保持上述範圍、回答和真實execution引用時的語義建議；我沒有替最後 audit JSON 進行工具 gate 宣告。如果最終scope擴張成完整verify/release能力，operation不能沿用這個4分和原結論。

## 特別核對的證據陷阱

- **初次互動程序非零exit不能當 recorder success。** 初次自己runtime先close、再停止idle transport所致的4294967295，僅是封存observation的一部分。支持4分所需的execution依據應是後來exit0的`session.capture.json`，保留初次資料作blind chronology；草案目前正確區分。
- **Recorder出口0不是每個子命令都0。** #002、#007、P03/P05/P20及memory錯version是刻意負例；capture正常結束表示斷言涵蓋其預期拒絕，不是說它們本身成功。最終引用应選真正欄位，不能只引`ALL_CHECKS_PASSED`。
- **SHA不是語義認證。** 26個參照一致與既有exehash支持版本綁定，不證明其來源就是checkout HEAD，也不讓selected subject成為完整dependency graph。binary本體超recorder單檔限制，由descriptor+probe直接hash明確處理，不能默默用HEAD替代。
- **Core宣告與已測面向分開。** renderer_probe=not_probed；SDK wrapper、MCP、GPU、browser、其他平台和真實遊戲都未獲此分數。這些限制應出現在final answer和report target.scope，而非只藏在長附件。
- **操作失敗與dependency未證明分開。** `LUAU_ANALYZER_NOT_FOUND` 是保留中的onboarding依賴問題；starter tests/assets結果不能補成types pass。後續session probe明確verifyNotReplayed=true，沒有覆蓋掉初次失敗。

## 可交付的判斷

保留85.5草案與目前scoped threshold結論，先修正warmup與null兩處用語。No score downgrade required within this declared representative scope. 保留五項friction register；其中找不到記憶體API的問題應改善development-tool discovery，已有memory/replay機制不應被誤認為需要再建一套。所有真正待測項目保持未宣稱，不藉此擴大授權或進行實作。
