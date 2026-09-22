# Two-stage, demand-driven discovery

本輪方向：AI 先說目的取得少量候選，選定後才取得完整 API 契約。
這是 discovery 策略，不取代執行、授權或 MCP transport。

```text
目的 → recommend（少量用途／限制／原因）
     → describe（只取選中 API 的完整契約）→ call（明確執行）
```

「兩段」指摘要選擇、詳細操作；call 是執行，不是另一輪全量 discovery。
MCP 本身已有 tools/list 與 tools/call，未規定人機互動必須載入所有 API。
參考 [MCP Tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。

## 分工

- 共用 AI 工具層：索引已安裝／授權 plugin 的摘要，依需求推薦候選、取得單一 API 描述。
- plugin：維護自己的用途、同義字、輸入輸出、錯誤、範例、限制、副作用與版本。
- host：真正決定當前可用性與授權，再執行；不能信任商店宣稱 readOnly 就放行。
- Viewer：顯示與讓人選擇，不成為 AI 探索 API 的必要中介。
- Koncrate 商店可推薦「尚未安裝」，但必須標記；不能混成目前可立即呼叫的能力。

## 本 plugin 已實作

`ai_native.recommend/describe/call`，由 `src/discovery.mjs` 的
`createDiscovery(contracts)` 共用函式提供。候選最多 5，預設 3；不回完整 schema。
完整契約 hash 鎖定選中的 metadata/schema；過時呼叫會提示重新 describe。
`ai_native.call` 仍獨立做輸入與檔案邊界驗證。未知能力回空候選，不亂推薦。
第一次是 deterministic keyword match，不聲稱理解所有自然語言；可追加同義字、重排器而不改 call。
新建／自評意圖同時符合 init 與 evaluate 時，init 固定排第一；明確要驗證既有報告時，evaluate 保持優先。這是已覆蓋的窄規則，不代表具備通用語意理解。

## 尚未改的範圍

既有 Unone 已有 plugin list → inspect → call，MCP 用固定 plugin 工具發現。
這輪沒有修改 CLI/MCP host，也沒有把 shader/UI/animator 等插件批量遷移。
未來共用 recommend 可以先讀 compact metadata，再呼叫對應 describe；保留舊直接工具的相容路徑。
新插件可重用本函式與契約模式；不要在每個插件裡再塞一個付費推薦 agent。

## 驗收標準

1. 從代表性中英文需求能推薦正確候選，含推薦理由及未涵蓋范围；同義字漏掉有空結果修復提示。
2. 未選前不傳全部 schema；選一個只回一個完整可執行契約。
3. 無候選、未安裝、缺條件、過期 hash、錯參數都有具體回饋。
4. 推薦不能觸發執行／安裝／授權；call 仍執行完整驗證。
5. 量測 payload bytes/steps 及任務成功；bytes 不冒充模型 token 數，也不為省文字刪掉安全限制。
