# AI authoring source review

候選：63ee132（相對64a702a）。狀態：Claude審查完成、Luna/max A/C審查待回覆；
不等於package-only驗收完成。

## Claude CLI

獨立print session，tools空、safe-mode、strict MCP、dontAsk、no-session-persistence。
prompt見2026-09-06-authoring-source-prompt.txt；輸入為當時tracked crates diff與
新scene.rs／兩個CLI integration tests全文，不提供先前review答案。
重建輸入字串UTF-8 SHA256：3aafca439953ee1b1c9b84793e4c4b54b7207e7746ba6ba9ad9ef6b46c9f43a8。
此為stdin文字、未包含PowerShell管線結尾換行。之後唯一source變更是把Web
test-only SceneFile import移至test module。CLI exit0；下列為實際stdout的摘要，非逐字原文。

| 意見 | 主代理覆核 |
|---|---|
| Windows windows_sys可能未宣告 | 不成立：engine Cargo.toml19原已宣告0.61.2與FileSystem feature；Windows build/test/clippy均實跑成功。不得添加重複依賴。 |
| pack無manifest也驗scene會改變舊行為 | 刻意修正silentaccept；165個workspace harness結果成功，新增有/無manifest負例矩陣。不存在容舊需求。 |
| host位置對fragment而非envelope | 刻意且已在mobile-host-abi與ai-workflow聲明source_kind/location_scope/pointer_base；不新增通用source-map框架。 |
| init preflight與寫入間TOCTOU | 已知single-writer限制，補入current教學，不聲稱抵禦惡意並行替換；不藉此擴成filesystem transaction。 |
| starter dt可能不是1/60 | runtime.rs24明確FIXED_DT=1/60，實測starterverify與故意改壞移動量test失敗；假設已排除。 |
| CLI transport測試留temp | 接受衛生改進候選，非功能blocker；不接受裸remove_dir_all清理建議。日後可使用明確owned TempDir；本輪自建fixture保留便於查核。 |

## 主代理整合驗證

165個harness tests exit0，其中3個Windows symlink privilege案例明示skip。
主代理額外actualjunction probe根/祖先皆拒絕且未寫入target。Clippy workspace
all-targets -D warnings exit0，Node6項回歸成功。starter回傳4步argv原樣實跑成功。
證據在../evidence/2026-09-06-ai-authoring。不以此冒充新遊戲盲評或平台finalgate。
