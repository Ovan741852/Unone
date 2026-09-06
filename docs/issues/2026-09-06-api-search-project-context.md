# API search 建議命令遺失 project context

日期：2026-09-06。狀態：confirmed / user-approved / implementation-in-progress。
分類：engine developer protocol／workflow contract，影響所有由包目錄操作遊戲的AI。
發現者：獨立Luna/max Newton。候選63ee132；immutable package來源969da77。

## 重現與事實

1. 從C:/Temp/unone-authoring-gate-20260906/engine執行包內CLI：
   `bin/game.exe --project <有效遊戲root> --json api search "攻擊"`。
2. api.rs90-104回傳固定建議`game systems list --json`，未保留project。
3. 主代理在同一包目錄實際執行`bin/game.exe systems list --json`，exit1，
   ok=false，code=PROJECT_CONFIG_NOT_FOUND，嘗試讀取engine/project.unone.json。

API搜尋本身是global index，不應因沒有專案而失敗；但systems list讀取project
config，不能把它當成project-independent command。若cwd恰有另一專案，更可能
得到錯專案的成功結果。現有parity測試只證明CLI/MCP同樣輸出這個壞提示，沒有
從不相干cwd執行後續命令；這是驗收缺口，不是遊戲邏輯問題。

## 已批准的窄修

保持API search的global查詢能力，對project-dependent下一步明確綁定呼叫project。
優先使用structured executable/argv，不把任意root拼shell字串；CLI/MCP共用core，
維持相同context。沒有可用project時明示必要前提，不製造可執行但指向cwd的建議。
加跨cwd、空白/Unicode、CLI/MCP解包parity及實際執行後續argv回歸。
不新增全域workflow service、api list命令、embedding或scene CRUD。

設計理由：不將ProjectPath本身改成Option，因CLI/MCP現有呼叫必定帶path（預設`.`）；
「沒有可用project」由同一discovery/validation結果表達。API索引不需project，因此
只阻擋依賴project的systems action。專屬ApiSearchAction避免為此修改所有診斷的
ActionSuggestion；command=null明確移除錯的shell提示，不保留第二份來源。
Targeted Luna/max複審未發現具體設計blocker；採納ready/argv/null狀態一致與跨cwd測試
建議，不將「最好用Option」當成必要重構。製作與複審結果仍須實測。

使用者已回覆「做」，批准修正原計畫C「固定systems list命令」的設計，由Luna/max製作，
再獨立複審／rebuild／另產新immutable package。969da77包保留證據，不覆寫、不交付
為passed。原定新遊戲盲評尚未dispatch，output仍空；現有starter Web只是main probe。

## 審查其他意見

Newton最初的normal-dot路徑疑點已由實測排除並撤回；不為不成立的假設改路徑設計。
Claude source review的依賴/dt/fragment位置等疑點已逐項核對，見source review報告。
