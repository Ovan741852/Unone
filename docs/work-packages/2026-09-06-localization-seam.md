# 工作包：多語系接縫（先單一語言）

日期：2026-09-06。計畫代理：Claude（主代理）。實作：codex / luna。
基準：`master` 的 `29937e4`。狀態：`planned`。

## 決定

**現在只做單一語言，但把接縫做進契約**，讓之後加語言是**加一個檔案**，不是
回頭改每一個顯示文字的地方。

## 要防的是什麼

今天遊戲是這樣寫的：

```luau
text = "SCORE " .. tostring(score)
```

字面字串在 Luau 裡直接串接。這件事本身能跑，但它讓「之後加語言」變成一次
全面重寫：每一個顯示文字的位置都要找出來、改成查表、還要確認沒漏。而**漏掉
的那幾個不會有任何 gate 抓得到**——它們只是永遠顯示英文。

接縫的目的就是讓這次重寫不會發生。單一語言的遊戲照樣把文字寫進表裡，
加第二語言時**遊戲程式碼一行都不用改**。

## 契約

### 專案宣告

```json
"locale": {
  "default": "zh-Hant",
  "tables": { "zh-Hant": "strings/zh-Hant.json" }
}
```

v1 只會有一個表。`tables` 是 map 而不是單一路徑，正是為了加第二個時不用改
結構。未宣告 `locale` 的專案行為完全不變。

### 字串表

```json
{
  "version": 1,
  "strings": {
    "hud.score": "分數 {value}",
    "hud.credits": "信用點 {value}",
    "button.spin": "開始"
  }
}
```

- key 是遊戲自己的命名空間，引擎不規定階層。
- 參數用**具名** `{value}`，不是位置參數。理由：翻譯時語序會變，具名參數才
  能重排；而且看不到畫面的作者寫具名比寫 `{0}` `{1}` 不容易錯。
- 參數值由遊戲**格式化好再傳**（數字、日期、貨幣）。引擎不做數字格式化、不做
  複數規則、不引入 ICU。這是刻意的邊界：那些需要 locale 資料庫，而引擎不該
  背一個。

### UI 節點

節點的文字二選一，與 `rect`／`anchor` 的二選一同一個習慣：

```json
{ "kind": "text", "id": "hud-score", "rect": {...},
  "text_key": "hud.score", "params": { "value": "1200" } }
```

- `text`：字面字串，維持現狀，不經過查表。
- `text_key` + 可選 `params`：查表後代入。
- 兩者同時給或都不給 → 錯誤。

### 解析在引擎，不在 host

`api.ui.setRoot` 當下就解析完成，snapshot 帶的是**已解析的 `text`**，另外附
`text_key` 供追溯：

```json
{ "kind": "text", "id": "hud-score", "text": "分數 1200", "text_key": "hud.score" }
```

這一點是整個設計的關鍵：**host、layout gate、既有 `ui` assertion、ASCII 圖
全部不需要改**。它們看到的仍然是最終文字。

### 查不到的 key 是錯誤，不是 fallback

缺 key 直接 `UI_STRING_KEY_MISSING`，附上缺的 key 與該表宣告了哪些 key。

不做「找不到就顯示 key 本身」——那正是上架遊戲畫面出現 `hud.score` 的原因。
引擎的既有原則是不靜默出錯。

### 不要本地化 observation

`view_model.message = "win"` 是**狀態代號**，不是顯示文字。它進 digest、進
assertion，必須跨語言保持不變。

只有進到 UI tree 的東西才本地化。這條界線要寫進文件，因為它很容易被搞混：
遊戲會很想把 `message` 直接拿去顯示。正確做法是 `message` 保持 `"win"`，UI
節點用 `text_key = "status.win"`。

## v1 實作範圍

| 檔案 | 內容 |
|---|---|
| `crates/unone-engine/src/project.rs` | `LocaleConfig { default, tables }`；`ProjectConfig.locale: Option<LocaleConfig>` |
| `crates/unone-engine/src/locale.rs`（新） | 表的載入與驗證、`resolve(key, params)`、缺 key 與缺參數的診斷 |
| `crates/unone-engine/src/ui.rs` | `RawUiNode` 加 `text_key`／`params`；二選一驗證；解析後填入 `text` 與 `text_key` |
| `crates/unone-engine/src/runtime.rs` | 載入時讀入 default locale 的表，交給 `UiTree::from_json_for_viewport` |
| `crates/unone-engine/src/api.rs` | `ui.setRoot` descriptor 補說明；新增 `common_errors` |
| `crates/unone-engine/src/engine.d.luau` | UI 節點的 `text_key`／`params` |
| `docs/project.schema.json` | `locale` |
| `docs/strings.schema.json`（新） | 字串表格式 |
| `docs/scene.schema.json` | 不動（UI 不在 scene 裡） |

`verify` 新增一個 step：**表裡宣告了但沒有任何畫面用到的 key**，以及**畫面
用到但表裡沒有的 key**。後者已經是 setRoot 的執行期錯誤，前者是靜態檢查，
兩者都只在有宣告 `locale` 時才跑。

### 回歸測試

1. 未宣告 `locale` 的既有專案行為與 digest 完全不變。
2. `text_key` 解析後，snapshot 的 `text` 是最終文字、`text_key` 保留。
3. 缺 key、缺參數、同時給 `text` 與 `text_key`、兩者都不給 → 各自明確錯誤，
   且**不留下部分更新的 UI tree**。
4. 具名參數重排：同一組 params 在兩個語序不同的模板下都正確。
5. `ui` assertion 與 layout gate 不需要修改就能通過——證明解析在引擎的決定
   有效。

## 刻意延後（都是加東西，不是改東西）

| 之後要加的 | 為什麼現在不做 | 加它時要改什麼 |
|---|---|---|
| 多個語言表 | v1 只有一個語言 | 加一個 `tables` 條目 |
| host 回報玩家語言 | 沒有第二語言可切 | 加一個 host ABI 呼叫與 `api.locale.current()` |
| fallback 鏈（缺譯回退） | 只有一個表無從回退 | 加 `fallback` 欄位 |
| 每個語言各跑一次 layout gate | 同上 | layout gate 迴圈跑每個 locale |
| 複數規則、數字／日期格式化 | 需要 locale 資料庫 | 若真的需要，另立契約；遊戲自己格式化仍是預設 |

**最後一列的第四項是這次投資的主要回報**：不同語言的文字長度差很多，同一個
版面在中文不重疊、在德文重疊，是真實而且常見的問題。等到有第二個表，layout
gate 只要對每個 locale 跑一次就能抓到——**因為現在就把文字放進表裡，那時候
不需要改任何遊戲程式碼**。

## 對老虎機的影響

[老虎機工作包](2026-09-06-slot-machine-reference.md)使用單一語言，但所有顯示
文字必須走 `text_key`，不得直接寫字面字串。這是本包唯一對它的要求，成本是
把字串搬進一個 JSON 檔。

## 不做

- 不做翻譯工具、不做匯出匯入格式、不整合任何翻譯服務。
- 不本地化 asset（不同語言的圖片走 asset manifest，不是字串表）。
- 不本地化 observation 或 save payload。
