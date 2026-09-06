# 工作包：`ui_previews` 支援 `load_save`

日期：2026-09-06。計畫代理：Claude（主代理）。實作：codex / luna。
基準：`master` 的 `5eaed77`。狀態：`planned`。規模：一個可選欄位。

## 決定

**要支援。** 判準是使用者給的兩條：AI 是否需要、實務上是否用得到。

### AI 是否需要

layout gate 存在的唯一理由是 AI 看不到畫面。它的價值與它**涵蓋幾個不同畫面**
成正比。有一整類畫面只有在載入存檔後才會出現，而 `input_sequence` **無法**
偽造存檔——沒有任何按鍵順序能讓一個全新的專案長出「上次玩到第 7 關」的狀態。

因此沒有 `load_save`，這類畫面對 gate 是**永久盲區**，而且是無聲的盲區：
`verify` 會全綠，作者不會知道有畫面沒被檢查過。

### 實務上是否用得到

用得到，而且正好是 layout gate 最擅長的情況：存檔相關畫面的**節點數量會變**。

- 有存檔才出現的「繼續遊戲」按鈕——節點多一個，可能撞到旁邊的按鈕。
- 背包／收藏／關卡選擇——列出的項目數來自存檔，數量變則版面變。
- 帶進度的結算畫面——多出「新紀錄」之類的條目。

節點數固定的畫面不太會突然重疊；**節點數會變的畫面才是重疊的高風險區**，
而它們幾乎都是存檔驅動的。

### 老虎機不是這個決定的證據

老虎機的 `restored` 畫面與 `ready` **結構完全相同**：同樣 7 個節點
（`title`、`reel-1..3`、`status`、`spin`、`save`）、同樣的 rect，只有 `status`
的文字從 `ready` 變成 `restored`。layout gate 檢查結構不檢查文字，所以把它
納入 gate **一無所獲**。

我把這件事寫出來，是因為用一個實際上沒有差別的例子去論證一個契約改動，會讓
下一個人以為這個欄位在老虎機上有價值。它沒有。它的價值在上面那一類遊戲。

## 契約

`UiPreviewSpec` 新增一個可選欄位，語意與 `test_files` 的 `load_save` **完全
相同**：不透明的 game-owned JSON，在 `Game.start` 之前注入。

```json
"ui_previews": [
  { "name": "continue", "frames": 1, "load_save": { "version": 1, "level": 7 } }
]
```

| 欄位 | 型別 | 未宣告時 | 語意 |
|---|---|---|---|
| `load_save` | 任意 JSON | 不注入 | 與 `test_files` 的同名欄位相同；引擎不解讀、不驗版本、不做 migration |

`input_sequence` 與 `load_save` 可以同時使用：先還原存檔，再重播輸入。

## 實作

| 檔案 | 內容 |
|---|---|
| `crates/unone-engine/src/project.rs` | `UiPreviewSpec` 加 `#[serde(default)] pub load_save: Option<serde_json::Value>` |
| `crates/unone-engine/src/verify.rs` | `layout_step` 由 `EngineRuntime::load_with_seed` 改用**既有的** `load_with_seed_and_save`，把 `preview.load_save.clone()` 傳進去 |
| `crates/unone-cli/src/main.rs` | `ui preview` 加 `--load-save <path>`，讀檔後同樣走 `load_with_seed_and_save`，讓宣告的 gate 能被單獨重跑 |
| `docs/project.schema.json` | `ui_previews` 的 items 加 `load_save`，說明它與 `test_files` 同語意 |
| `docs/ai-workflow.md` | `ui_previews` 段落補一句：存檔驅動的畫面用這個欄位到達 |

`load_with_seed_and_save` 已經存在（[issue](../issues/2026-09-05-blind-xiao-mary-findings.md)
第 2 項修正時建立），本包**不需要**新的載入路徑。

`verify` 的 step `command` 欄位要跟著帶上 `--load-save`，否則作者無法單獨重跑
那一個 gate——每個 step 都必須可單獨重現是既有規則。

## 回歸測試

1. 宣告帶 `load_save` 的 preview，遊戲在 `Game.start` 讀得到該存檔，且畫面
   節點與不帶存檔時**不同**（用一個節點數會變的測試遊戲，不要用老虎機）。
2. `input_sequence` + `load_save` 同時宣告：先還原再重播，兩者都生效。
3. 未宣告 `load_save` 的 preview 行為與現在完全相同（既有專案不受影響）。
4. `verify` 回報的 `command` 含 `--load-save`，且照該命令單獨執行結果一致。

## 不做

- 不把 `test_files` 的其他欄位搬進 `ui_previews`。`load_save` 是唯一無法用
  輸入序列表達的狀態來源，其他欄位沒有這個性質。
- 不加存檔版本檢查或 migration。引擎對 save payload 仍然不透明。
