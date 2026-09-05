# 資產工作流：獨立計畫審查

日期：2026-09-06。初稿 `146baeb`；審查者 Hubble，Luna/max，未繼承主對話。
本紀錄保留決策原因，不是第二份 API 規格。現行範圍見工作包。

## 第一輪

審查者只讀程式與 v1，未執行測試；結論為有 blocking findings。

| Finding | 主代理核對與處理 |
|---|---|
| CLI/MCP all 參數未具体化 | 接受明確化，但不是已實作 bug；v1 的互斥要求已存在。v3 指定 optional id、all bool、共用選擇驗證與四種組合測試 |
| 空/重複 bundle 跨 host 規則不一致 | 接受。native 找第一筆同 id，Web 允許空集合/空 id；v3 定義共同拒絕案例與 shared fixture，保留 native subset 語意 |
| 最新 active record 損壞時靜默回退 | 接受架構性原因。共用 loader fail closed，修 read/inspect/describe；不另加 pointer 或第二權威 |
| companion strict/path containment 落差 | 接受。共用小型 resolver 覆蓋此資產流程的讀取，不擴張重寫全部 IO；明確授權的 export output 不套用來源限制 |
| MCP asset read 可能寫入卻標 read-only | 接受最小修正 readOnlyHint=false，不新增 export 別名 |

主代理另補入 v2/v3：共用 source 的其他 asset id、selected-asset freshness
範圍、manifest entry 與 bytes 都比較、查詢跨 generation 一致性、init 部分寫入
失敗的 effects、pack/inspect 的 first-pack 順序、後續動作 prerequisites。

動態 Luau 引用、實際 native 貼圖、格式匯入器並非本輪完成項，不靠假 green
掩蓋。Git 舊紀錄保留；被取代的現行資產規格檔於替代文件落地時刪除。

## 再審

v3 經同一獨立 reviewer 限定再審：五項均處置，未發現仍存的計畫層 blocking
矛盾；可以製作，並非 code／產品通過，也非全量 repo audit。共用 fixtures、
generation token、effects、刪規格後封裝與真正盲測仍必須以實作證據驗收。

製作前主代理回歸 `cargo test --workspace`：100 passed（CLI 6、engine 82、
mobile 8、Web ABI 4）。工作樹沒有功能改動。
