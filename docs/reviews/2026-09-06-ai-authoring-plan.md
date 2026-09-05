# AI authoring 計畫獨立審查處置

日期：2026-09-06。Reviewer：Aquinas，Luna/max，未繼承主對話。
範圍：計畫、必要 source／現行契約、主代理 baseline probes；不是封裝盲驗。
目前：v2 待限定複審；未開始 A/B/C 實作。

## 第一輪：v1

| Finding | 主代理處置 |
|---|---|
| B 未收斂 consumer、host errors、shared vector strictness | 採納。v2 列 disk/typed/payload/reference/pack（有無 manifest）矩陣，選 closed shared Vec2/Vec3 JSON wire；一個 parser/semantic validator。既有 HostProject 僅 scene 延後解析，用 RawValue 保留原片段，以現有 write_diagnostic 傳錯；不擴建 FFI/DTO framework |
| A 的安全寫入與 partial failure 無精確契約 | 採納。v2 固定 preflight→逐層 mkdir→create_new/write 順序、ancestor/reparse 檢查、成功 report、失敗 facts/effects/排序與局部 writer 故障注入；部分檔建立就記錄，不等 write 完成才記 |
| 實際遊戲 gate 仍可能被 starter tests 冒充 | 採納。驗收 #6 直接納入完整盲測企劃，starter 僅 onboarding smoke；game-owned 成敗/停止/restart 與負向改規則測試都是硬條件 |
| CLI/MCP search parity 建議 | 採納。固定 no-match、empty-query full index、有效 term fixtures；只比較共同結果，不錯比 transport wrapper |
| 前案退出證據具名 | 採納。指定 predecessor-gate.json 必備 provenance/build/package/盲验欄位；未跑不建立假通過證據 |

不照單接受的部分：review 的「empty scene」用語未區分空場景與空白 id。
v2 明確保留 `{}` / `entities:[]` 合法，只拒絕空白／重複 entity id。
不追求沒有原始 source 時也能產生行列；typed semantic error 使用 pointer，
host scene parse 使用片段相對行列，未知 pointer 留 null。
review 的 MCP source link 寫成 engine crate，實際為
`crates/unone-cli/src/mcp.rs`；後續文件使用實際路徑。

v1 被現行計畫直接取代，沒有另留可被當成現行規格的舊副本；Git 留歷史。
原始 typo／duplicate 反例不覆寫，後續修復驗證另外存檔。
