# Decision 0029：畫面結構要有一個文字形式的 gate

日期：2026-09-05

## 背景

小瑪莉的盲測子代理通過了引擎提供的每一個 gate：`check --types`、`asset inspect --strict`、六個 deterministic 測試、UI tree 完整相等比對。畫面實際打開卻是壞的——37 個 UI 節點裡有 17 對互相重疊，30 個節點的文字放不進自己宣告的框。

子代理不可能知道，因為它看不到畫面；主代理也沒發現，因為它看的是同一批 JSON。這不是子代理的疏忽，是**引擎沒有任何一個 gate 在檢查排版**。

截圖無法補這個洞：它不能進 test assertion、不能進 observation digest、在沒有 GPU 的機器上產生不出來，而且對模型來說是最貴的輸入形式。

## 決定

新增 `game ui preview` 與 MCP `unone_ui_preview`：跑指定 frame 數之後，把已發布的 UI tree 畫成字元格，並回報結構問題。

- 輸出預設是 markdown：ASCII 圖 + 節點表 + findings，方便人與模型直接讀。`--json` 給機器動作用。
- `UI_NODES_OVERLAP`：兩節點 rect 相交，圖上以 `#` 標記，附重疊量。
- `UI_TEXT_EXCEEDS_RECT`：以 16:9 viewport 與 0.5 字寬比例估算，文字放不進宣告的框。
- `--strict` 讓 findings 變成 `ok=false` 與非零 exit code。交接文件把它列為必要步驟。

出界的 rect 沒有對應檢查，因為 `UiTree::from_json` 早就拒絕它了；不加重複的假檢查。

## 邊界

它只回報**結構**：重疊、放不下。它不判斷美觀、不做排版、不選字型、不知道實際 viewport 比例（估算的假設會如實寫在報告的 `assumptions`）。世界層（sprite 與實體位置）目前沒有對應的文字檢查。

## 原因

- ASCII 是**確定性字串**：可以斷言、可以進 digest、不需要 GPU 或字型，而且是模型讀取畫面最便宜的形式。
- 這三件事截圖一件都做不到。
- 把「AI 看不見畫面」從一個永久缺陷，變成引擎可以代替它看的東西。

## 已知限制與下一步

- 文字寬度是估算，不是排版；細字型或 CJK 會有偏差。真正的解是 host 把文字貼合宣告的框，那是 host 的修正。
- 世界層還沒有等價工具；憤怒鳥的 sprite 被畫到畫布外，同一輪沒有被任何 gate 抓到。
- 之後若加入格線排版語法（如 CSS `grid-template-areas` 形式），這張圖正好是它的驗證輸出。
