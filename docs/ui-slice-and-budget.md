# 九宮格與 UI 容量契約 v2

更新：2026-09-20。這是可複用的引擎／呈現 primitive，不是遊戲規則。
Core 擁有 typed tree、邊距／裁切驗證與容量契約；Web/native host 負責繪製。
皮膚、按鈕、動作、MVVM、畫面組裝仍在 Luau 或插件，不進 Rust。

## 一張圖、一個節點

先在資產 manifest 宣告 `texture://ui/frame`，指向一張 PNG 或 host 支援的
靜態 SVG。不要為九宮格另外產生九張 PNG，也不要把原圖整張拉伸。

```lua
api.ui.setRoot({
    kind = "screen", id = "inventory", node = "inventory",
    children = {{
        kind = "image", id = "frame", asset = "texture://ui/frame",
        rect = { x = 10, y = 10, width = 80, height = 80 },
        slice = {
            left = 16, top = 16, right = 16, bottom = 16,
            pixels_per_unit = 8,
        },
    }},
})
local report = api.ui.inspect()
api.observation.set("ui_budget", report)
```

- `left/top/right/bottom` 是來源圖的像素邊距，必須有限且非負，兩側相加要小於來源尺寸。
- `pixels_per_unit` 必須大於零：每個垂直設計單位對應多少來源像素。1 設計單位 = viewport 高度的 1%。例：上例 16 / 8 = 2 單位，在 1080 高度中角高 21.6 px。
- 可選 `source={x,y,width,height}` 指定來源圖內的 atlas／去透明邊區域。單位是來源像素，原點左上、y 向下。邊距以這個區域為基準。UI `rect` 則仍然 y 向上，兩者不要混用。
- `fit` 省略或指定 `stretch`。有 `slice` 時它代表拉伸邊／中心，不是整張拉伸；`contain/cover` 會回報衝突。
- 四角維持同一縮放比，橫邊只延展寬、直邊只延展高，中心延展兩軸。目標小到放不下四角時，四邊一起等比縮小，不能互相重疊。
- 一個邏輯節點、一次 asset reference，最多九個 render regions。這不等於一次 GPU draw call。透明區仍保留既有矩形 hit-test 規則。
- 解碼後仍檢查來源實際尺寸。`UI_SLICE_BOUNDS` 帶來源／節點資訊；不能靜默改成整張拉伸。SVG 仍受各 host 的静態資產安全限制。

UnoneUI 0.5.0 的 `UI.image(spec)`／`ui.generate(image, spec)` 同樣接收 `slice`。
無需安裝插件也能直接使用 Core API；UI 架構不是強制依賴。

## 預算不等於效能

唯一來源是 `crates/unone-engine/src/ui-contract.json`，Rust 直接讀取；Web 與插件
的 JS／Luau 副本由 `scripts/sync-ui-contract.mjs` 生成並可檢查漂移。

| 項目 | 目前值／行為 |
| --- | --- |
| 預設節點預算 | 2048（舊的固定 256 已移除） |
| 每張 screen 自訂 | `budget={max_nodes=4096}`，不是全域隱藏設定 |
| Host 安全上限 | 16384；防失控，不是某裝置的效能評分 |
| 計數 | 包含 component wrappers 與其所有子節點，不含 screen root |
| Wrapper 深度 | 16 |
| 字串總量 | 8 MiB UTF-8 |
| 超限 | 拒絕該次發布，保留上一個有效畫面；不截斷、不刪內容 |

`api.ui.inspect()` 回傳真正執行中的 `contract`，以及最新成功發布的 `usage`：
`logical_nodes`、`leaf_nodes`、`render_regions_upper_bound`、`max_nodes`、
`host_max_nodes`、`limit_source`、頂層 `subtrees` 計數。尚未發布時 usage 為 nil。

`UI_NODE_LIMIT` 回報第一個超限節點的 path、id、used、limit 與 host_max_nodes。
先消除九節點組裝與檢查實際成本，再決定是否提高預算；不要為滿足任意門檻刪掉功能。
非法預算是 `UI_BUDGET_INVALID`，深度是 `UI_DEPTH_LIMIT`，字串超量是 `UI_STRING_LIMIT`。

排版工具另有工作量保護：最多 1,000,000 次配對比較／1024 個 findings，超限附
`UI_LAYOUT_WORK_LIMIT`，結果不會標成 readable。保留完整節點表，可以逐個子樹檢查。
這只限制診斷工作量，不限制渲染內容；AABB 也不等於像素遮擋／美術品質驗證。

Canvas report 提供最後一次實際重繪的 `cpu_render_ms`、`render_regions`、
`decoded_rgba_bytes_estimate`（不含瀏覽器／GPU 副本）。`gpu_render_ms=null` 表示未量測，
不會以零冒充。Native 沿用既有 `raster_ms`／`upload_bytes`。
Native 目前仍是 CPU raster → GPU 合成，大量逐幀變動 UI 不能宣稱 60 FPS。

## 配套與驗證

更新插件不會更新已打包的 WASM／native。先用匹配的 Core、CLI、Web host、native player
重新建置，再匯出遊戲。舊 runtime 的未知欄位錯誤不是需要把圖拆回九張的理由。

```text
game api describe ui.setRoot --json
game api describe ui.inspect --json
game schema ui --json
node scripts/sync-ui-contract.mjs --plugin <UnoneUI checkout> --check
```

測試入口與實際結果見 [2026-09-20 驗證紀錄](evidence/2026-09-20-ui-slice-and-budget.md)。
Schema 是結構檢查；全樹總數、來源解碼尺寸等仍由 runtime validator 判定。
