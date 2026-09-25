# Node tree, prefabs and `unone.editor` — proposed v1 contract

**Status: design only. Nothing in this document is callable today.** Current
`SceneFile` is a flat `entities` list with fixed component slots, `entity.spawn`
creates an empty entity, and `runtime-contracts.md` lists prefabs and entity
lifecycle as unfinished. Do not add the fields below to existing scene files
before the loader accepts them; unknown-field rejection is intentional.

本文件設計三件事，目標都是「AI 好理解、好生成、改錯時知道為什麼錯」：

1. **Node tree**：場景與 prefab 共用的節點資料格式 `unone.nodes.v1`。
2. **Prefab**：可實例化、可巢狀、可覆寫的節點模板。
3. **`unone.editor`**：查詢「這裡能改什麼、怎麼改」，並提供有型別的修改介面，
   填錯時回傳語意化診斷與可直接執行的修正建議。

CLI、MCP、以及未來的人類 Editor 共用同一套操作（ADR 0001）。

---

## 1. Ownership classification

依 AGENTS.md 先分類，再決定放哪裡：

| 能力 | 分類 | 放置 |
| --- | --- | --- |
| 節點父子關係、transform 繼承、子樹生成/刪除 | 可重用引擎機制，每種遊戲都需要 | Rust Core |
| Prefab 檔案格式、解析、覆寫合併、循環偵測 | 可重用引擎機制 | Rust Core |
| Prefab 宣告的 `props`（型別、範圍、預設值） | 引擎只儲存與驗證型別 | Rust Core 驗證；**意義**屬於 Luau |
| 生成時機、要生成哪個 prefab、`hp` 代表什麼、傷害怎麼算 | 遊戲規則 | Luau |
| 查詢/修改/驗證 authoring 檔案 | 開發工具，不進 runtime | `unone-cli`（`game editor …`、MCP `unone_editor_*`） |
| Inspector UI、gizmo、拖拉 | 人類操作介面 | Editor/Viewer host |
| 萬人規模的 crowd | 不適用 prefab | 維持 `instances3d`（見 §8） |

`props` 是關鍵：它讓 editor 能改遊戲數值而**不用解析 Luau**，但 Rust 不解讀它，
只保證 Luau 讀到的值型別正確、在範圍內。

---

## 2. 設計原則：為什麼這樣對 AI 友善

| 原則 | 做法 | 對 AI 的好處 |
| --- | --- | --- |
| 扁平，不巢狀 | `nodes` 是 `id → node` 的物件，父子用 `parent` 欄位表達 | 不必生成深層巢狀括號；移動節點只改一個欄位 |
| 路徑穩定 | 所有位置都用 JSON Pointer，例如 `/nodes/arm/transform3d/rotation/y` | 沒有陣列索引漂移；診斷、查詢、修改用同一種路徑 |
| 一個事實只存一處 | prefab 的 id 由 `assets.json` 宣告，檔案內不重複 | 不會出現兩處 id 不一致 |
| 覆寫是差異，不是複本 | 實例只記 `overrides: { pointer: value }` | 生成量小，diff 乾淨，看得出改了什麼 |
| 值有來源 | 查詢時每個值標明來自 `default` / `prefab` / `override` | AI 知道該改 prefab 還是改實例 |
| 關閉未知欄位 | 沿用 `deny_unknown_fields` | 拼錯欄位一定報錯，不會被靜默忽略 |
| 正規化輸出 | editor 寫檔一律 canonical 格式 | AI 手寫和工具寫出的檔案 diff 一致 |
| 錯誤可執行 | 診斷附 `suggested_actions`，其中含可直接送出的修正操作 | AI 不用猜怎麼修 |

---

## 3. Data format: `unone.nodes.v1`

場景和 prefab 用**同一種節點格式**。差別只在場景多了場景層級設定（camera、physics）。

### 3.1 Prefab file

`prefabs/ballista.prefab.json`：

```json
{
  "format": "unone.nodes.v1",
  "props": {
    "hp":   { "type": "number", "default": 180, "min": 1, "description": "Hit points. Read by Luau; the engine does not apply damage." },
    "team": { "type": "enum", "values": ["red", "blue"], "default": "red", "description": "Owning army." }
  },
  "nodes": {
    "root": { "transform3d": { "position": { "x": 0, "y": 0, "z": 0 } } },
    "base": { "parent": "root", "mesh3d": { "asset": "mesh://ballista-base" } },
    "arm":  { "parent": "root", "order": 1, "transform3d": { "position": { "x": 0, "y": 1.2, "z": 0 } } },
    "bow":  { "parent": "arm",  "mesh3d": { "asset": "mesh://ballista-bow" } }
  }
}
```

在 `assets.json` 宣告，走既有的 hash / bundle / 驗證流程：

```json
{ "id": "prefab://ballista", "kind": "prefab", "source": "prefabs/ballista.prefab.json" }
```

### 3.2 Node fields

| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| key（node id） | string | `^[a-z][a-z0-9_-]{0,63}$`，在同一檔案內唯一 |
| `parent` | string? | 同檔案內的 node id；省略代表根節點 |
| `order` | integer? | 兄弟節點排序，預設 0；同值依 id 字母序（沿用 sprite layer 的 tie-break） |
| `name` | string? | 顯示名稱，不影響邏輯 |
| `transform` / `rotation` / `scale` | 同現有 `SceneEntity` | 2D **local** transform |
| `transform3d` | 同現有 `Transform3DData` | 3D **local** transform |
| `sprite` / `mesh3d` / `rigidbody` / `animation` | 同現有 component 結構 | 直接沿用現有 DTO 與 schema |
| `prefab` | string? | `prefab://…`；有此欄位時，此節點是 prefab 實例 |
| `overrides` | object? | 只在 `prefab` 存在時允許；key 是相對於該 prefab 的 JSON Pointer |
| `props` | object? | 只在 prefab 實例上允許；等同 `overrides` 對 `/props/*` 的簡寫 |

結構規則：

- prefab 檔案必須**恰好一個**根節點；場景可以有多個。
- 一個子樹內不可混用 2D 與 3D transform。
- v1 中 `rigidbody` 只允許出現在根節點或 prefab 實例的根（見 §7 `NODE_RIGIDBODY_NOT_ROOT`）。
  物理在世界座標模擬，掛在會移動的父節點下語意不清，先禁止，之後有真實需求再放寬。

### 3.3 Scene file

場景用同一格式，多出場景層級欄位：

```json
{
  "format": "unone.nodes.v1",
  "camera": { "position": { "x": 110, "y": 155, "z": 165 }, "target": { "x": 0, "y": 0, "z": 0 }, "fov_degrees": 48 },
  "nodes": {
    "terrain": { "mesh3d": { "asset": "mesh://terrain" } },
    "red_ballista_1": {
      "prefab": "prefab://ballista",
      "props": { "team": "red", "hp": 220 },
      "overrides": {
        "/nodes/root/transform3d/position": { "x": -40, "y": 0, "z": 12 },
        "/nodes/bow/mesh3d/asset": "mesh://red-ballista-bow"
      }
    }
  }
}
```

相容性：沒有 `format` 欄位的舊檔仍走現有 `entities` 陣列。`game editor migrate`
把 `entities[i]` 轉成以 `id` 為 key 的根節點，行為不變。兩種寫法不可在同一檔案混用。

### 3.4 Runtime identity

實例化後，子節點的 runtime entity id 是**可推導的路徑**：

```text
red_ballista_1          ← 實例根（prefab 的 root 節點）
red_ballista_1/base
red_ballista_1/arm
red_ballista_1/bow      ← bow 的父節點是 arm，但 id 不包含 arm
```

規則：`<instance id>/<local node id>`，巢狀 prefab 繼續串接
（`army/ballista_3/bow`）。只串「實例」層級，不串父節點鏈，所以 reparent 不會改掉 id。
AI 看到 runtime id 就能反查是哪個 prefab 的哪個節點；`observe`、`snapshot`、
`enact` 的 entity selector 直接可用。

### 3.5 Override rules

- 允許覆寫：component 欄位、`props/*`、`order`、`name`。
- 不允許覆寫：`parent`、node id、`prefab`（結構變更必須改 prefab 本身或用 `extract_prefab`）。
- 覆寫值必須符合目標路徑的 schema；目標路徑必須在 prefab 中存在或其 component 可被新增。
- 巢狀 prefab 的覆寫以外層實例為準（外層勝出）。
- 解析順序固定：schema default → prefab 值 → 巢狀外層覆寫 → 實例覆寫。

---

## 4. Luau API（提案）

```luau
-- 生成整棵子樹，回傳根 entity id
local id = api.node.instantiate("prefab://ballista", {
  id = "enemy_ballista",                 -- 可省略；重複時加 _2, _3（同 entity.spawn）
  parent = nil,                          -- 可指定已存在的 entity 作為父節點
  props = { team = "blue", hp = 200 },
  overrides = { ["/nodes/root/transform3d/position"] = { x = 30, y = 0, z = -8 } },
})

api.node.destroy(id)                     -- 刪除整棵子樹（含 contact、effect）
api.node.getProps(id)                    -- { hp = 200, team = "blue" }，已套用預設值
api.node.children(id)                    -- 依 order 排序的直接子節點 id
api.node.parent(id)                      -- string?
api.node.setParent(id, newParent)        -- runtime reparent，保留 world transform
api.entity.getWorldTransform3D(id)       -- 新增；現有 get/set 讀寫 local
```

`instantiate` 的 props/overrides 與 authoring 使用**相同驗證器**，所以 runtime 填錯
和 editor 填錯拿到的是同一個診斷 code。

每個函式照現有 `api.rs` 慣例提供 descriptor（purpose、when_to_use、when_not_to_use、
common_errors、example），並加進 `engine.d.luau` 型別定義。

---

## 5. `unone.editor`：查詢介面

全部是唯讀，不啟動 runtime，不寫檔。CLI 為 `game editor <verb>`，MCP 為
`unone_editor_<verb>`，結果都是 `EngineResult`。

### 5.1 `describe` — 看懂一個檔案或 prefab

```json
{ "command": "describe", "target": "prefab://ballista" }
```

回傳節點樹（已排序）、每個節點的 component 摘要、宣告的 props、被哪些檔案引用
（`used_by`），以及檔案的 `content_hash`（修改時用來做並行檢查）。

### 5.2 `resolve` — 值從哪裡來

```json
{ "command": "resolve", "target": "scene.json", "path": "/nodes/red_ballista_1/nodes/bow/mesh3d/asset" }
```

```json
{
  "value": "mesh://red-ballista-bow",
  "provenance": [
    { "layer": "prefab",   "file": "prefabs/ballista.prefab.json", "path": "/nodes/bow/mesh3d/asset", "value": "mesh://ballista-bow" },
    { "layer": "override", "file": "scene.json", "path": "/nodes/red_ballista_1/overrides/~1nodes~1bow~1mesh3d~1asset", "value": "mesh://red-ballista-bow" }
  ],
  "edit_here": { "op": "set_override", "note": "Changing the prefab would not affect this instance because an override wins." }
}
```

`resolve` 使用的「虛擬路徑」`/nodes/<instance>/nodes/<local>/…` 可以穿進 prefab 實例，
AI 不用自己拼 override key；`edit` 接受同一種路徑並自動轉成正確的 override。

### 5.3 `schema` — 這裡能填什麼（「怎麼修改」的核心）

```json
{ "command": "schema", "target": "scene.json", "path": "/nodes/red_ballista_1/props/team" }
```

```json
{
  "path": "/nodes/red_ballista_1/props/team",
  "type": "enum",
  "values": ["red", "blue"],
  "default": "red",
  "current": "red",
  "description": "Owning army.",
  "declared_by": "prefab://ballista",
  "editable": true,
  "example_op": { "op": "set", "path": "/nodes/red_ballista_1/props/team", "value": "blue" }
}
```

針對不同型別附上不同線索：

- asset 欄位：列出 `assets.json` 中**種類相符**的候選 id（例如只列 `mesh3d`）。
- `parent`：列出合法父節點（排除自己與子孫，避免循環）。
- 整個節點（路徑停在 `/nodes/<id>`）：列出可新增的 component 與目前已有的 component。
- 不可編輯的路徑：`editable: false` 加原因（例如「parent 不可覆寫，請改 prefab 或用 extract_prefab」）。

### 5.4 `ops` — 有哪些修改操作

```json
{ "command": "ops" }
```

回傳 §6 所有操作的 JSON Schema、一句話用途、example、常見錯誤 code。
跟 `game api search ""` 一樣，是完整索引，不需要猜名稱。

### 5.5 `find` — 找節點

```json
{ "command": "find", "target": "scene.json", "where": { "prefab": "prefab://ballista", "props.team": "red" } }
```

也支援 `has_component`、`asset`、`name_contains`。回傳路徑清單，可直接餵給 `edit`。

---

## 6. `unone.editor`：修改介面

### 6.1 Request

```json
{
  "command": "edit",
  "target": "scene.json",
  "expected_hash": "sha256:4f1c…",
  "dry_run": true,
  "operations": [
    { "op": "instantiate", "parent": null, "id": "blue_ballista_1", "prefab": "prefab://ballista",
      "props": { "team": "blue" } },
    { "op": "set", "path": "/nodes/blue_ballista_1/nodes/root/transform3d/position", "value": { "x": 40, "y": 0, "z": -12 } }
  ]
}
```

- **原子性**：任何一個操作失敗，整批不套用（與 `enact` 相同）。
- **並行檢查**：`expected_hash` 與目前檔案不同就拒絕（`EDIT_STALE_HASH`），附上新 hash 與
  變更摘要；AI 與人同時改檔時不會互相覆蓋。
- **dry_run 預設 true**，回傳完整結果但不寫檔。
- 同一批操作可以引用前面操作新增的節點。
- 上限：每批 1..128 個操作、序列化輸入 256 KiB。

### 6.2 Operations

| op | 用途 | 主要欄位 |
| --- | --- | --- |
| `add_node` | 新增一般節點 | `id`, `parent?`, `order?`, `components` |
| `instantiate` | 新增 prefab 實例 | `id`, `prefab`, `parent?`, `props?`, `overrides?` |
| `remove_node` | 刪除節點與整棵子樹 | `id`, `cascade: true`（必填，防止誤刪子樹） |
| `reparent` | 移動節點 | `id`, `parent`, `keep_world_transform?` |
| `rename_node` | 改 node id，同步更新同檔案內的 `parent` 引用 | `id`, `new_id` |
| `set` | 設定任意可編輯路徑（可穿透實例，自動轉 override） | `path`, `value` |
| `unset` | 回到預設或移除覆寫 | `path` |
| `add_component` / `remove_component` | 增減 component | `node`, `component`, `value?` |
| `declare_prop` / `remove_prop` | 在 prefab 宣告/刪除 props | `name`, `schema` |
| `extract_prefab` | 把一棵子樹抽成新 prefab 並替換成實例 | `root`, `prefab_id`, `source` |
| `apply_overrides` | 把實例的覆寫推回 prefab | `instance`, `paths?` |

`extract_prefab` 與 `apply_overrides` 會跨檔案（新增 prefab 檔、修改 `assets.json`），
結果中的 `files` 會列出每個檔案的變更；`expected_hash` 可以是 `{ file: hash }` 物件。

### 6.3 Result

```json
{
  "ok": true,
  "value": {
    "dry_run": true,
    "files": [
      {
        "file": "scene.json",
        "before_hash": "sha256:4f1c…",
        "after_hash": "sha256:9a02…",
        "changes": [
          { "path": "/nodes/blue_ballista_1", "kind": "added" },
          { "path": "/nodes/blue_ballista_1/overrides/~1nodes~1root~1transform3d~1position", "kind": "added",
            "value": { "x": 40, "y": 0, "z": -12 } }
        ],
        "text_diff": "@@ …"
      }
    ],
    "inverse": [ { "op": "remove_node", "id": "blue_ballista_1", "cascade": true } ],
    "warnings": []
  },
  "diagnostics": [],
  "effects": []
}
```

- `inverse` 是可直接送出的反向操作，Editor 的 undo/redo 就用它，不需另一套 undo 系統。
- `text_diff` 讓人類與 AI 在 commit 前審閱實際檔案變化。
- 提交後回傳 `effects: ["write scene.json"]`，並建議下一步 `verify`。

### 6.4 `check` — 驗證手寫的檔案

AI 也可以直接寫 JSON 檔。`game editor check` 用與 `edit` **完全相同**的驗證器，
並把診斷對應到檔案的行列（`SourceLocation.line/column`）。`check` 成為 `verify`
新增的 `nodes` gate；手寫與工具寫入拿到相同錯誤。

---

## 7. Semantic diagnostics

沿用現有 `Diagnostic` 結構（`code`、`summary`、`explanation`、`facts`、
`likely_causes`、`suggested_actions`、`source`）。本提案固定三個約定：

1. `facts.path` 一定是 JSON Pointer；`facts.expected` 與 `facts.actual` 一定存在。
2. 若有接近的合法值，`facts.nearest` 列出（編輯距離 ≤ 2，或同種類的 asset）。
3. `suggested_actions` 至少一項帶 `operation` 欄位：一個可直接放進 `edit` 的修正操作。
   （`ActionSuggestion` 需新增選填 `operation: serde_json::Value`，現有 `command` 保留。）

### 7.1 Example

AI 送出 `{"op":"set","path":"/nodes/red_ballista_1/props/team","value":"Red"}`：

```json
{
  "code": "NODE_VALUE_ENUM",
  "severity": "error",
  "summary": "props.team must be one of the declared values.",
  "explanation": "prefab://ballista declares team as an enum. Enum values are case-sensitive; \"Red\" is not declared.",
  "facts": {
    "path": "/nodes/red_ballista_1/props/team",
    "expected": { "type": "enum", "values": ["red", "blue"] },
    "actual": "Red",
    "nearest": ["red"],
    "declared_by": { "file": "prefabs/ballista.prefab.json", "path": "/props/team" }
  },
  "likely_causes": ["Value capitalised differently from the declaration."],
  "suggested_actions": [
    { "action": "use_nearest", "description": "Use the declared value \"red\".",
      "operation": { "op": "set", "path": "/nodes/red_ballista_1/props/team", "value": "red" } },
    { "action": "extend_enum", "description": "If \"Red\" is a new team, declare it in the prefab first.",
      "operation": { "op": "declare_prop", "target": "prefab://ballista", "name": "team",
        "schema": { "type": "enum", "values": ["red", "blue", "Red"], "default": "red" } } }
  ],
  "source": { "file": "scene.json", "line": 9, "column": 41 }
}
```

### 7.2 Code catalogue

依驗證階段排列；前一階段失敗時不跑後面階段，避免連鎖誤報。

| 階段 | code | 何時 | 典型修正建議 |
| --- | --- | --- | --- |
| 解析 | `NODE_JSON_INVALID` | JSON 語法錯誤 | 指出行列與期待的符號 |
| 解析 | `NODE_FORMAT_UNSUPPORTED` | `format` 不是 `unone.nodes.v1` | 列出支援版本；舊檔建議 `migrate` |
| 結構 | `NODE_ID_INVALID` | id 不符合規則 | 給出正規化後的 id |
| 結構 | `NODE_ID_DUPLICATE` | 新增的 id 已存在 | 給出可用 id（`_2`） |
| 結構 | `NODE_PARENT_MISSING` | parent 不存在 | `nearest` 列相近 id |
| 結構 | `NODE_PARENT_CYCLE` | 形成循環 | 列出循環路徑 `a → b → a` |
| 結構 | `PREFAB_ROOT_COUNT` | prefab 根節點不是 1 個 | 列出所有根，建議加共同父節點 |
| Schema | `NODE_FIELD_UNKNOWN` | 未知欄位 | `nearest` 列相近欄位名 |
| Schema | `NODE_VALUE_TYPE` | 型別錯 | 期待型別與範例值 |
| Schema | `NODE_VALUE_RANGE` | 超出 min/max | 裁切後的值 |
| Schema | `NODE_VALUE_ENUM` | 不在 enum 中 | 最接近的值 |
| 引用 | `ASSET_REF_MISSING` | asset id 未宣告 | 相近 id；或 `asset init` 指令 |
| 引用 | `ASSET_REF_KIND` | 種類不符（把 texture 填進 mesh3d） | 列出種類相符的候選 |
| 引用 | `PREFAB_MISSING` | prefab id 未宣告 | 相近 prefab |
| 引用 | `PREFAB_CYCLE` | prefab 直接或間接引用自己 | 列出引用鏈 |
| 覆寫 | `OVERRIDE_PATH_MISSING` | 覆寫的節點/欄位在 prefab 中不存在 | 列出 prefab 內相近路徑 |
| 覆寫 | `OVERRIDE_PATH_FORBIDDEN` | 覆寫 parent / id / prefab | 建議 `extract_prefab` 或改 prefab |
| 覆寫 | `OVERRIDE_REDUNDANT` (warning) | 覆寫值等於 prefab 值 | `unset` 操作 |
| Props | `PROP_UNDECLARED` | 設定 prefab 沒宣告的 prop | `declare_prop` 操作 |
| 語意 | `NODE_TRANSFORM_SPACE_MIXED` | 同子樹混用 2D/3D | 指出第一個衝突節點 |
| 語意 | `NODE_RIGIDBODY_NOT_ROOT` | 非根節點有 rigidbody | 建議 reparent 到根或抽成實例 |
| 語意 | `NODE_SYSTEM_DISABLED` (warning) | 有 rigidbody 但 `physics2d` 關閉 | `systems set` 指令 |
| 編輯 | `EDIT_STALE_HASH` | 檔案已被改動 | 新 hash、變更摘要、建議先 `describe` |
| 編輯 | `EDIT_OP_UNKNOWN` | op 名稱錯 | 相近 op 與 `ops` 指令 |
| 編輯 | `EDIT_REMOVE_REQUIRES_CASCADE` | 刪有子節點的節點但沒有 `cascade` | 列出會被刪除的子樹 |

所有 code 由 `game editor ops` 與 `schema` 輸出中的 `common_errors` 引用，AI 在修改前就能知道
可能遇到哪些錯誤。

---

## 8. Relation to existing systems

- **`enact`（developer session）**：仍是暫時性 runtime 修改。未來可加
  `editor promote --session S --entity red_ballista_1/bow`，把 session 內的實驗值
  轉成 `edit` 操作（dry-run），讓「在 runtime 調到滿意 → 寫回來源」成為一條明確路徑。
  v1 不做，但 runtime id 路徑（§3.4）已為此預留反查能力。
- **`instances3d`**：Legion Fall 那種萬人 crowd 不走 prefab。prefab 適合數十到數千個
  需要獨立 entity 的物件；大量同質單位繼續用 packed buffer。`instantiate` 的
  descriptor `when_not_to_use` 會寫明這點。
- **UI tree**：`UiNode` 已有自己的巢狀樹。v1 不合併；未來可讓 UI 也採用扁平 + parent
  格式，但屬另一份提案。
- **Bundle / asset**：prefab 是 `kind: "prefab"` 的一般 asset，自動納入 pack、hash、
  generation。`used_by` 查詢由 asset reference 圖產生。
- **Schema 產生**：`unone.nodes.v1` 的 JSON Schema 由 Rust DTO 產生（`game schema nodes`），
  `editor schema` 的回答以這份 schema 加上 prefab 宣告的 props 為準，不另寫一份描述。

---

## 9. Non-goals for v1

- Prefab 繼承 / variant（`extends`）。紅藍兩軍用「同 prefab + props/overrides」即可；
  有兩個以上驗證遊戲需要時再開 ADR。
- 非根節點的物理、joint、關節約束。
- 任意自訂 component 或逐節點 Luau script。遊戲資料放在 `props`，行為留在 Luau。
- Editor 視窗、gizmo、picking（host 端工作，依賴本提案但不屬於本提案）。
- 自動 merge 衝突。`EDIT_STALE_HASH` 只拒絕，由 AI 或人重新讀取後再改。

---

## 10. Delivery plan

| 階段 | 內容 | 驗收 |
| --- | --- | --- |
| 1 | `unone.nodes.v1` DTO、parser、驗證器、`editor check`、`verify` 新 gate、`migrate` | Legion Fall 與 starter 的場景 migrate 後，observation digest 不變 |
| 2 | Runtime：parent/transform 繼承、`node.instantiate/destroy/getProps/children` | headless 測試：巢狀 3 層 prefab 生成、刪除後 entity/contact 歸零、replay 一致 |
| 3 | `editor describe/resolve/schema/ops/find` + MCP 工具 | 每個 §7.2 code 至少一個 fixture，斷言 `facts.path` 與 `operation` 可直接執行並修好錯誤 |
| 4 | `editor edit`（原子、hash、dry-run、inverse、canonical 寫檔） | `edit` 後再套 `inverse` 得到與原檔位元組相同的內容 |
| 5 | `extract_prefab`、`apply_overrides`、`web/developer` 的 Hierarchy/Inspector 接上 `schema` + `edit` | 人類與 AI 透過同一 API 操作；Inspector 表單由 `schema` 產生 |

### AI 生成品質驗收

加一組盲測：只給 AI `game editor ops` 與 `game api search ""` 的輸出，
請它完成「新增一個含三個子節點的 prefab、在場景放兩個實例、改其中一個的顏色 mesh」。
量測指標：第一次送出即通過的比例，以及失敗時僅依 `suggested_actions` 修正所需的輪數。
目標是任何錯誤都能在一輪內依診斷修好。
