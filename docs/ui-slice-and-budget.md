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

## Reusable background intent

A sliced image can also declare `background_for={component="ancestor_id"}` or
`background_for={screen=true}`. This is explicit background metadata on the
existing image/panel leaf; it adds no logical nodes and changes neither slicing
nor drawing order. Keep it inside the reusable Luau component function so each
instance carries its own intent. The background must fit its scope in the same
coordinate space. Only later descendants fully contained by that background
receive the scoped overlap exemption; foreground collisions and partial coverage
remain findings. Version-1 exact-pair policies still support deliberately layered
skins. See [the current scope contract](ui-styling.md#explicit-background-scopes).

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

## Retained image artwork

`api.ui.imageBatch.define(id,{bounds,quads})` stores an immutable logical artwork
resource. Define it in `Game.start` or explicitly replace its content in
`Game.update`; a pure View or virtual `renderItem` only references it. The Core
rejects resource mutations inside `renderItem`, including initial materialization.
The existing `image_batch` node then accepts `content=id` instead of inline
`quads`. The official `kit.imageBatch` constructor accepts the same two forms.
Canonical constructor inputs are `UiInlineImageBatchProps` and
`UiRetainedImageBatchProps`; `UiComponentImageBatchProps` is their union. Their
outer fields are read-only inputs, so fresh table literals and explicitly typed
variables can be passed directly; `background_for.screen=true` stays strict.
`never?` exclusions reject mixing the two forms or adding a transform to inline
quads. The constructor keeps its existing union signature and returns mutable,
game-owned nodes; no runtime freeze or new constructor is introduced.

```lua
-- Game.start: source pixels and local artwork coordinates are independent.
api.ui.imageBatch.define("background-art", {
    bounds = {x=0, y=0, width=200, height=100},
    quads = {{asset="texture://landscape",
        rect={x=0, y=0, width=200, height=100},
        source={x=0, y=0, width=1024, height=512}}},
})

-- Pure View: changing cameraX changes six small affine values, not image data.
local artwork = {
    kind="image_batch", id="background", content="background-art",
    rect={x=0, y=0, width=100, height=100},
    transform={a=1, b=0, c=0, d=1, tx=-cameraX, ty=0},
}
```

The required resource `bounds` contains every local quad rectangle. Local x/y
may be negative or extend beyond 0..100; dimensions and all coordinates must be
finite. Each quad retains the existing ordered `asset`, `rect`, optional pixel
`source` and `opacity` semantics. The engine owns source-dimension resolution,
quad tessellation, compatible GPU runs and resource lifetime. A game neither
groups textures nor sends GPU material flags.

The transform uses `x'=a*x+c*y+tx`, `y'=b*x+d*y+ty`, mapping local coordinates to
the existing stage y-up space. Omission means identity; a supplied transform
requires all six finite fields and finite transformed bounds. The node `rect`
is an explicit stage clip/layout viewport, never an implicit translation or
scale. Artwork outside that rect is clipped, with its source crop unchanged.
The node remains at its authored tree position, including A/B/A texture order
and interleaved text/controls. Retained artwork inside scroll content is
explicitly unsupported in this slice (`UI_IMAGE_BATCH_SPACE`). Ordinary inline
quads remain a logical authoring convenience with absolute-stage containment;
`transform` requires `content`, and mixing `content` with `quads` fails.

Definitions are copied and fully validated before publication. Identical content
preserves its generation; a successful replacement updates existing references
only after their complete node/string budgets and transforms still validate.
Every referenced quad counts for every instance. The registry is bounded to 256
resources, `host_max_nodes` total stored quads and the existing string budget.
The actual encoded JSON definition also has a 16 MiB per-resource limit and a
32 MiB aggregate registry limit. Escaped strings count at their encoded byte
size, including JSON syntax; the raw UTF-8 string budget alone is insufficient.
Each immutable generation computes/caches this encoding once before admission.
Over-limit content fails with `UI_IMAGE_BATCH_ENCODED_LIMIT` before replacing
either a resource or the published tree.
Unknown keys, invalid assets/crops/opacities and overflow reject atomically.
Decoded image crop bounds are still validated by the host.

`api.ui.imageBatch.remove(id)` returns whether an unused resource existed.
Removing a resource referenced by the published tree fails with
`UI_IMAGE_BATCH_IN_USE`; first publish a tree without that reference. Snapshot
leases can retain an old immutable generation until released. Recreating an id
gets a fresh engine revision. Resource definitions share world reset and reload
ownership; failed reload restores definitions and the UI tree together. Pure
tree creation never adds registry entries, including discarded/virtual views.

Complete canonical snapshots include `ui_image_batches[id]` with
`{revision,bounds,quads}` and the referencing UI node. The empty registry is
omitted to avoid unused data. A player may transport unchanged
generations by reference through its versioned private protocol; canonical
inspection and replay remain complete. An unchanged generation shares its
immutable content and cached JSON encoding across camera-only tree updates.

This slice targets the matching official Web player. Host capability admission,
ordered GPU acceleration, Canvas equivalence, recovery and performance must be
validated separately before claiming target support or 60 FPS; a host lacking
the retained contract must reject it clearly. Native/checked-raster parity is
not implied by the Core API or a passing headless test.

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
