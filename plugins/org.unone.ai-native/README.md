# Unone AI-native Audit

衡量「陌生 AI 是否能自己找到、用對、看懂結果、修復錯誤」的開發插件。
不是引擎 runtime、不是另一個編排器，也不是讓 AI 自稱 9/10 的認證。

需要 Node.js 20+，零 npm 依賴。可將整個目錄獨立搬到其他專案的
`plugins/org.unone.ai-native` 或 `UNONE_PLUGIN_PATHS`。不修改 Unone Core。

## 先問目的，再載入選中的契約

```sh
node cli.mjs recommend --query "Assess Scout itself for AI-native usability and give it an evidence-based score"
node cli.mjs describe --operation ai_native.init
node cli.mjs describe --operation ai_native.evaluate
```

第一個回覆只有少量候選、推薦原因、可用條件與下一步。第二個才有完整
schema、範例、錯誤修復與 `contractHash`。沒有對應功能會明說，不編造 API。
新評測建議先選 `ai_native.init`：它只把十題 JSON 範本回傳給呼叫者，**不寫檔，也不打分**。接著填入每題答案與證據，選擇 `ai_native.evaluate`。評分器可直接接收完整 `report` JSON，不必先建立檔案；仍可用 `report_path` 重驗專案內既有報告。選擇 evaluate 時會取得完整 reportSchema、兩種輸入方式及準備步驟。
第一版是可解釋的中英關鍵字比對，不是假裝有語意搜尋或跨商店檢索。

Unone CLI / MCP 使用既有 plugin discovery，只有四個啟動工具：

```powershell
game --project <project> --json plugin inspect --id org.unone.ai-native
game --project <project> --json plugin test --id org.unone.ai-native
# Input JSON: {"query":"我要評分 AI native"}
game --project <project> --json plugin call --id org.unone.ai-native --tool ai_native.recommend --input request.json
```

選擇後依序 describe/call `ai_native.init` 取得範本，填完後 describe/call `ai_native.evaluate`。若以 MCP 呼叫，可直接把已填報告作為 `arguments.report` 傳入；不需要求 Scout 寫檔。若已存在報告檔才使用 `arguments.report_path`。兩種輸入必須且只能提供一種。
快取契約可以重用；契約變更會拒絕舊 hash，要求重新取得。推荐和契約 hash 不構成授權。

沒有 `game` 也能獨立用 CLI，或透過標準 input/output：

```json
{"protocol":"unone.plugin.v1","action":"call","plugin":"org.unone.ai-native","tool":"ai_native.recommend","input":{"query":"我要評分 AI native"}}
```

將一行送進 `node plugin.mjs`，一行 `EngineResult` 回應。host 的
`UNONE_PROJECT_ROOT` 決定根目錄；payload 的 `project` 不能擴大權限。
插件套件版號與個別操作契約版號分開遞增：describe 的 `version` 是該操作輸入／輸出契約版號，`versionScope` 會明示此語意；它不等於 package/plugin 發行版號。新版契約只影響有變更的操作，不會強迫其他穩定操作一起改版。改變了直接報告輸入流程的 `ai_native.init` 與 `ai_native.evaluate` 是 0.3.0；尚未改過契約的 `ai_native.register` 仍是 0.2.0。

預設唯讀；0.2.0 的 `ai_native.register` 只有可信任 host 明確設定
`UNONE_AI_NATIVE_REGISTRY_WRITE=1` 才能追加評測檔，不能在請求裡自行授權。
限制與預期契約見 [兩段式 discovery](docs/discovery.md)。

CLI 支援 `node cli.mjs --help`、`help` 或不帶參數查看正確用法。`init` 將範本輸出到 stdout，不建立檔案。可把填好的 JSON 從 stdin 傳給唯讀評分器，避免建立中間報告檔：

```sh
node cli.mjs init --id my-tool --name "My Tool" > audit.json
# 編輯並補齊證據後：
node cli.mjs evaluate --root <project> --report audit.json
# 若呼叫者可直接提供 JSON，也可以：
node cli.mjs evaluate --root <project> --report - < audit.json
```

`--report -` 讀取 stdin，大小上限 2 MiB；stdin 必須是完整 UTF-8 JSON。`init` 和 `evaluate` 仍然唯讀。只有明確的 `register` 命令會新增登錄紀錄。

## 做一次實際評测

1. 先讀 [AI 評測指引](skills/unone-ai-native-audit/SKILL.md)。盲測只给 agent
   產品入口與代表任務，不透露預期答案；先用公開入口，卡住才記錄並翻源碼。
2. `node cli.mjs catalog` 看固定 10 題、權重與評分錨點。
3. `node cli.mjs init --id planner --name "企劃工具" --surface http` 回傳空白評測 JSON 到 stdout，不寫檔。
   由呼叫者選擇保存或直接把填好的 `report` 傳回評分器；逐題填答，未測必須寫原因，不能省略。
4. `node cli.mjs snapshot --root <project> --path README.md --path <relevant-source>`
   只指紋化選定檔案。`subject` 每項只取 path/sha256；證據另加 kind、quote。
5. 寫一個**經檢視的隔離探針**，用下方 recorder 實跑，保存負例與修復後結果。
6. `node cli.mjs evaluate --root <project> --report audits/planner/audit.json`，或透過 `--report -` 傳入 stdin JSON；MCP/API 可直接傳 `arguments.report`。
   修正報告格式或重跑真正過時的案例；不能只換 hash／抬高答案來追分。

報告契約與分數解讀見 [report.md](docs/report.md)。上述查詢／評分 CLI 僅輸出 JSON、不寫入受測專案。
`evaluate` 不會執行報告裡的任何命令。需要人類另外授權的登入、真實派工、付費 AI、
部署等不因評測而自動獲准；沒有權限就保留未驗證項。

## 保存評測、查分數與待重驗狀態（0.2.0）

```sh
node cli.mjs recommend --query "保存評測"
node cli.mjs describe --operation ai_native.register
# 唯一會寫入的 CLI 操作：先重新驗證既有證據，再追加一份新紀錄。
node cli.mjs register --root <project> --assessment equipment-20260915-01 --report audits/equipment/audit.json --manifest plugins/org.example.equipment/plugin.json
node cli.mjs history --root <project> --target org.example.equipment
node cli.mjs status --root <project> --assessment equipment-20260915-01 --version 1.0.0
```

三個操作也可透過 recommend → describe → call 使用。`register` 自動保存
分數、逐題結果、問題、版本、範圍、環境、時間、證據參照與 SHA-256；不是自動盲測。
插件需在原始 subject 就包含 manifest，非插件目標可省略 `--manifest`。
修改選定原碼／證據／評分器或版本後，`status` 回「待重驗」、`score:null`，
舊成績仍在 `historicalScore`。查詢不覆寫紀錄；介面不得把歷史分數當目前認證。
時間意義、儲存／備份、錯誤及精確邊界見 [評測登錄契約](docs/registry.md)。

### 保存可重跑探針

這是**明確選定腳本的本機執行器**，不是 plugin/MCP 工具，也不是安全 sandbox。
先審查腳本只能操作合成 fixture，沒有真實帳號、外部網路、provider 或使用者設定。
fixture 建在 OS temp；不要用真實企劃做負例。

```sh
node scripts/record-probe.mjs --root <project> --script audits/planner/probe.mjs --output audits/planner/capture.json --subject README.md --subject <relevant-source> --mode fixture --limitation "Synthetic identity; no real AI, GUI or cross-device verification"
```

探針收到 `--root <project>`，自行保證作用範圍與清理自己的 server。
只直接啟動 Node、無 shell，30 秒逾時（可設定 1–60 秒），輸出各限 256 KiB。
capture 記錄命令、環境、輸出、退出碼、時間與源碼／探針 hash。
如果探針還會讀取既有 fixture、重播 transcript 或其他資料檔，也要以 `--subject`
列入這些輸入，並在報告使用同一組 subject。只保存 probe hash 不會偵測外部輸入被改；
recorder 不會自動追蹤所有檔案讀取。若遺漏輸入，保留原 capture，补齊後實際重新錄製。
已存在的輸出直接拒絕，**不再執行**；需要重跑時指定新的 capture 路徑。
失敗／逾時也保留證據；源碼於執行間改變則不能評分。輸出可能含私人資料，分享前必須檢查。

## 能強制什麼，不能保證什麼

- 強制每題有答案、原因、證據與下一步；检查引用檔案存在、hash、原文摘錄、版本一致性。
- 不完整／未知欄位／冒用源碼當執行紀錄：具體拒絕，不回傳虛假的分數。
- 這是呼叫 evaluate 時的 gate，不會神奇地強迫所有 agent 每次開發都使用，也尚未接入產品發布 CI。
- 靜態證據、源碼協助與未驗證有明確上限；同時顯示公共操作覆蓋率。
- SHA-256 不能证明作者誠實，程式也不能自動理解答案真假。需要獨立審查、可重跑紀錄；高風險能力再做真實環境驗收。
- 分數是本專案自訂 rubric，不是業界標準；不同工具類型、任務、版本或環境不能直接排名。

## 回歸

```sh
npm test
node cli.mjs test
# Optional: verify with an existing Unone binary, no build required.
node scripts/verify-host.mjs --host <game-binary> --project <project> --report <relative-audit.json>
```

開發中不要從評測套件自動修改其他 plugin 或應用。問題以具體原因、修法與驗收步驟交還擁有者。
