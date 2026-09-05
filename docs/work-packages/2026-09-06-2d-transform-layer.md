# 工作包：2D transform / sprite layer

日期：2026-09-06。製作代理：Luna / max。基準：`master` 的
`d7cae90` roadmap；目前工作樹另有使用者確認決策的 `5ae821e` 文件提交。
狀態：`engine_verified`（主代理審查及回歸通過；Claude review 待补。
Host transform/layer 與跨平台驗收仍未完成）。

## 已確認的邊界

本工作包實作 roadmap #2/#3 的最小 2D 顯示 transform 與 sprite draw order。
碰撞語意引用已接受的 [Decision 0034](../decisions/0034-independent-2d-colliders.md)：

- Entity 的 `transform.x/y` 仍是物體的世界位置。
- 2D `rotation`/`scale` 只控制顯示，不會自動改變 `RigidBody2D` 的 radius、
  mass、velocity、contact、ground contact 或任何現有碰撞解算。
- 碰撞形狀與尺寸由 rigidbody 自己宣告；本包不新增形狀、角速度、角動量或
  旋轉碰撞解算。

本包也不新增 scene graph、pivot component、動畫、sprite atlas、貼圖管線或
物理角速度。普通 `sprite` 是本包的顯示對象；`web/presentation/main.js` 的
Spine actor 仍屬 animation host 範圍，不藉本包偷偷增加動畫 transform 抽象。

## Core contract（已定義，部分已落地）

### Scene / snapshot 的實際 serialized shape

保留既有 `entity.transform`，不把它改成另一種物件，也不新增平行的
`transform2d` scene node。最小 shape 是：

```json
{
  "id": "bird",
  "transform": { "x": 0, "y": 0 },
  "rotation": 0,
  "scale": { "x": 1, "y": 1 },
  "sprite": {
    "asset": "asset://bird",
    "size": { "x": 1, "y": 1 },
    "visible": true,
    "layer": 0
  }
}
```

`sprite` 仍然可以是 `null`/未設定；上例的 sprite 欄位只在有 Sprite 時
存在。`EntitySnapshot` 使用相同的 entity-level `rotation`、`scale` 與
`sprite.layer` 欄位。`sprite.size` 是未縮放的基礎世界範圍；host 的視覺
範圍是 `size * scale`，而 `rigidbody.radius` 不參與這個乘法。

欄位與預設如下：

| 位置 | 欄位 | 型別 / 單位 | 未宣告時 | 驗證與用途 |
|---|---|---|---|---|
| entity | `transform` | `Vec2 {x:number,y:number}` | 既有 `Vec2::default()` | 保留原本位置與 physics 用途 |
| entity | `rotation` | finite `number`，radians | `0` | 顯示旋轉；不影響 rigidbody |
| entity | `scale` | finite positive `Vec2` | `{x:1,y:1}` | 顯示乘在 sprite size；禁止負值鏡像 |
| sprite | `layer` | signed portable `i32` | `0` | painter layer；不是 z 軸、不是 physics |

Scene 由 serde additive-default 讀取；snapshot 明確序列化新欄位。因此未
設定的舊場景仍然是零旋轉、單位縮放、layer 0，畫面中心、大小與 physics
行為不變；這是 default 行為，不是舊格式 compatibility layer。因 snapshot
shape 增加欄位，完整 observation digest 的 JSON 也會增加欄位。

### Luau API contract

既有 `entity.getPosition` / `entity.setPosition` 不改名、不改用途，仍只讀寫
`transform.x/y`。新的 aggregate API 名稱定為：

- `entity.getTransform2D(id) -> Transform2D`
- `entity.setTransform2D(id, transform: Transform2D) -> ()`

Luau 型別的實際 shape 是：

```luau
export type Transform2D = {
    position: Vec2,
    rotation: number, -- radians
    scale: Vec2,      -- x/y > 0
}
```

`setTransform2D` 先驗證完整輸入，再一次寫入 position/rotation/scale；非有限
position/rotation、零或負 scale 都回傳 runtime error，失敗不得留下部分更新。
這個 API 不會取得或改變 rigidbody，也沒有本包的 `setSpriteLayer`：layer 是
scene 宣告並透過 snapshot 供 host 排序的資料。若未來遊戲證明需要 runtime
改 layer，應另立 API 契約，不在本包擴規格。

`entity.getTransform2D`/`setTransform2D` 的 world 內部方法、Luau binding、
descriptor 與兩份 canonical typing 已同步；getter 讀取呼叫當下的 world state，
setter 在同一個 script call 中原子更新完整 transform。

### Rotation、scale、pivot

- rotation 與既有 `Transform3DData` 一樣使用 radians。
- 引擎座標是 y-up；正角是 counter-clockwise。
- Entity position 是 visual 的中心點；rotation/scale 繞中心套用。
- scale 只接受 x/y 都大於 0 的有限值；負值鏡像、獨立 flip 欄位都不在本包。
- 既有 `sprite.size` 是 base extent；host 要以 `sprite.size.x * scale.x`、
  `sprite.size.y * scale.y` 畫出中心對齊矩形或貼圖。canvas/CSS 的 y-down
 角度符號轉換是各 host 的實作 gate，不改 engine 儲存的 radians。

### Layer 與同層排序

`sprite.layer` 是 JSON number 對應 Rust `i32`，可攜範圍明確為
`-2147483648..2147483647`，不是 float、不是未限定大小的 host integer。

對所有可見普通 Sprite，host 必須在畫之前建立排序鍵
`(layer, entity.id)`：

1. `layer` 以 signed numeric ascending 比較；低 layer 先畫。
2. 同 layer 以 `entity.id` 的 UTF-8 byte lexicographic ascending 比較；後畫的
   物件在上層。這個 comparator 等同 Rust `BTreeMap<String>` 對有效 UTF-8
   字串的字典序，也可由 JS/Java 明確比較 UTF-8 bytes，禁止 `localeCompare`
   或 `JSONObject.keys()` 順序。
3. 不以 scene array、JSON object iteration、執行緒或建立順序當 tie-break。

目前 core 只保存 `layer`；真正 renderer 的排序與像素/DOM regression 要在
下一段 host 實作中證明。`WorldSnapshot.entities` 仍是 id-keyed map，不宣稱
它本身已是一個 painter-ordered array。

## 目前已改的 core

- `crates/unone-engine/src/world.rs`
  - 新增 `Transform2DData`、entity `rotation`/`scale`、`SpriteData.layer`。
  - `World::load_scene_data` 在替換 physics/camera 或插入 entity 前驗證所有
    2D visual fields，避免 malformed scene 造成部分污染。
  - `World::snapshot` 明確回傳 quantized rotation/scale；physics step 只讀
    `entity.transform` 與 rigidbody state，沒有讀 visual fields。
  - 新增 `World::get_transform2d` / `World::set_transform2d`；setter 先驗證
    再 mutate。
  - 新增 defaults、signed32 layer、snapshot、invalid update、physics
    independence 的 unit regression。
- `crates/unone-engine/src/runtime.rs`
  - 新增 `observation_digest(&WorldSnapshot)`；直接序列化傳入的 snapshot，沿用
    `sha256:` + lowercase hex，serialization error 會回傳 diagnostic，不 hash
    empty buffer。
  - 接上 `entity.getTransform2D` / `entity.setTransform2D`，新 API 的 setter
    先驗證再 mutate。
  - 新增同 seed `1337`、同 120-frame input sequence 的 runtime regression：
    只改 scene rotation/scale 時，snapshot 的 visual fields 與完整 digest
    改變，但 position、velocity、contacts、ground contacts 相同。
  - 新增 helper 的 byte-definition、different-state 與 read-only tests，以及
    2D Luau API smoke test。
- `crates/unone-engine/src/lib.rs`
  - re-export `Transform2DData` 與公開 root `observation_digest`，供 Web host
    接線使用。
- `crates/unone-engine/src/api.rs`
  - 新增 `entity.getTransform2D` / `entity.setTransform2D` descriptors；getter
    說明是「呼叫當下」。
- `crates/unone-engine/src/engine.d.luau`、`docs/engine.d.luau`
  - 同步 `Transform2D` 與 EntityApi members；同時補齊 docs copy 原本缺少的
    `despawn` / `setSpriteVisible`。
- `docs/scene.schema.json`
  - 新增正 scale 的 `scale2d`、entity `rotation`/`scale` defaults，以及
    signed32 `sprite.layer` bounds/description。

## 現有實作與 owner / 後續寫檔位置

| owner | 現有位置與函式 | 要接的內容 | 狀態 |
|---|---|---|---|
| world entity/snapshot | `crates/unone-engine/src/world.rs`：`SceneEntity`、`SpriteData`、`EntitySnapshot`、`EntityState`、`World::load_scene_data`、`World::snapshot`、`World::step_physics` | state、default、validation、snapshot | core 已改 |
| Luau runtime | `crates/unone-engine/src/runtime.rs`：`build_api`、`EngineRuntime::observe`、`EngineRuntime::reload_source` / `reload_if_changed`、`run_internal`、`observation_digest` | get/set aggregate API、invalid input、canonical digest、不改 reload policy | core/API 已改 |
| API discoverability | `crates/unone-engine/src/api.rs`：`typings()`、`descriptors()`、`the_type_contract_covers_every_documented_api` | `entity.getTransform2D` / `setTransform2D` descriptors 與 examples | 已改 |
| canonical Luau types | `crates/unone-engine/src/engine.d.luau` | `Transform2D`、EntityApi members | 已改 |
| public/package typings | `docs/engine.d.luau` | canonical 同步副本 | 已改 |
| scene schema | `docs/scene.schema.json`：`$defs/entity`、`$defs/sprite` | additive fields/defaults/ranges | 已改 |
| native preview | `crates/unone-cli/src/main.rs`：`Renderer::render` 2D branch | center rotation、visual scale、visible sprite、`(layer,id)` sort；procedural quad 仍是 preview | host gate，未改 |
| Web shared renderer | `web/shared/webgpu-snapshot.js`：`semanticSummary`、`verticesFor` | summary fields、quad transform、layer sort | host gate，未改 |
| Web DOM asset layer | `web/runner/main.js`：`renderAssets`；`web/runner/index.html` 的 `.unone-asset-sprite` CSS | DOM size/rotation/scale、CSS stacking/sort | 另一代理寫入邊界，未改 |
| Web live ABI host | `crates/unone-web-live-smoke/src/main.rs`：`write_snapshot`、`write_runtime_snapshot` | snapshot envelope 只需跟隨 core；digest 若要共用 Rust helper 另依 #14 決策 | 另一代理寫入邊界，未改 |
| Android host | `platform/android/src/com/unone/android/UnoneActivity.java`：`UnoneView.drawWorld` | visible、centered rotation/scale、signed layer sort；Canvas y-down 角度轉換 | host gate，未改 |
| Spine presentation | `web/presentation/main.js`：`syncSpineActors` | 目前只消費 x/y；本包不把 animation 抽象擴成普通 Sprite transform | 明確 out-of-scope |
| replay/digest | `crates/unone-engine/src/runtime.rs::run_internal`、`crates/unone-engine/src/diff.rs::recorded_frame` | full snapshot 自動帶新欄位；既有 replay baseline 需重新錄製 | `diff.rs` 不在本段可寫清單 |

## Save、reload、replay、digest

- `api.save` 仍是 game-owned opaque payload；engine 不把 Entity visual transform
  自動塞進 save、不遷移 game payload。若遊戲自己保存 rotation/scale/layer，
  版本與 migration 仍由遊戲負責。
- `EngineRuntime::reload_source` / `reload_if_changed` 只替換 script，保留
  Rust-owned world；因此已設定的 visual fields 不會因 script hot reload 被清掉。
  初次 `load_scene`/`load_source` 仍使用 scene 欄位與 defaults。
- `run_internal` 對完整 `WorldSnapshot` 做 observation digest，
  `diff.rs::recorded_frame` 也序列化完整 snapshot。新欄位會使有 visual 差異
  的 digest/recording 差異可見；這不等於 physics 改變，回歸必須分開比對。
- `unone_engine::observation_digest` 是 Web 可直接接線的 root export；它不
  observe、不 tick、不碰 seed/time/perf。`EngineRuntime::run_internal` 現在也
  呼叫同一 helper，serialization error 直接形成 failed `EngineResult`。
- 本段不改 `diff.rs` 的 schema version；其既有 `recorded_frame` 仍在自己的
  recording 路徑序列化 snapshot。舊 recording 沒有新 snapshot fields 時不提供
  compatibility layer；baseline 需在契約完成後重新 record。

## 最小真實 regression（下一段 host gate）

用一個最小 scene 放三個可見 Sprite：`back` layer `-2`、`same_a` layer `0`、
`same_b` layer `0`，另放一個 dynamic circle。固定 seed/input/120 frames，做
兩次 run：第二次只改 `same_b` 的 rotation/scale（以及可視大小）。驗收要同時
有：

1. core snapshot 看到 rotation/scale/layer，invalid zero/negative/non-finite
   input 失敗且原 world 未被污染。
2. physics 的 position、velocity、contacts、ground contacts byte/field
   equal；visual fields equal only when intentionally unchanged。
3. native/Web/DOM/Android 各以同一 `(layer,id)` contract 證明 `back` 在底、
   `same_a` 在 `same_b` 前；同層不能依賴 object iteration。
4. rotation 以中心為 pivot，scale=1 的未設定場景與既有畫面範圍一致；host
   y-down 只轉換畫面角度，不回寫 snapshot。

本階段未指派/未執行遊戲盲測；本節是交給後續 host/盲測 owner 的可重跑 gate
計畫，不冒充已取得跨 host 畫面證據。

## 代表遊戲 package-only 盲測企劃

代表案例選 roadmap 的 2D physics 壓測 **Angry Birds**。盲測代理只收到完成
打包後的 immutable engine package、一份 `GAME_PLAN.md` 與空遊戲目錄，不收到
本 repo、其他 host 原始碼或本工作包代理的提示。

`GAME_PLAN.md` 只要求代理：建立兩個同位置/同 rigidbody 的可見物件，固定 seed
與 input run；一份使用 rotation=0、scale=(1,1)，另一份只變 visual
rotation/scale；再建立不同 signed layer 和同層不同 id 的 sprite；用 package
提供的 verify/API/schema/run/replay 工具找出 snapshot、physics 與 draw order
證據。代理必須報告：

- `transform.x/y` 仍是物體位置，visual state 出現在 observation；
- 兩次物理 position/velocity/contact/ground contact 相同，完整 digest 因
  snapshot visual state 不同而不同；
- 零/負 scale 被拒絕且不污染 world；layer `i32::MIN`、`i32::MAX` 可載入，
  超界輸入被 schema/engine 拒絕；
- 可見圖像與同層 tie-break 的 host evidence，並明確標出尚未支援的平台。

本階段未指派/未執行此盲測；已 commit 的 package-only GAME_PLAN 由主代理另案
指派。故不宣稱 Angry Birds、native preview、Web 或 Android 已通過。

## Production write boundary / resolved blocker history

### `[RESOLVED] CORE-TYPINGS-WRITE-BOUNDARY`

首次檢查發現 `crates/unone-engine/src/api.rs::typings()` 使用
`include_str!("engine.d.luau")`，而 `api.rs` 的
`the_type_contract_covers_every_documented_api` 會檢查 embedded canonical type；
最初派工清單漏列 `crates/unone-engine/src/engine.d.luau`。主代理已補正範圍，現在
canonical source、`api.rs` descriptors/runtime binding 與 `docs/engine.d.luau`
已同步，未改 include path。

### 已知的另一工作包邊界

另一製作代理可改 `web/runner/main.js`、`web/runner/index.html` 與
`crates/unone-web-live-smoke/src/main.rs`。本工作包目前沒有碰這些檔案，也沒有
全 repo formatter。本段已完成唯一 core `observation_digest` helper；Web 代理
只需接 root export，不另造 hash/serialization 規則。本段仍未修改 `diff.rs` 或
其他未授權檔案。

## 待使用者決定

本 core 契約無待使用者決定。Decision 0034 的碰撞獨立語意、canonical typing 寫入
範圍，以及 Web canonical digest「抽出」決策均已確認並在本段完成相應 core
工作；後續安排 host 實作。整合時另發現 Web sprite 中心偏移，已記錄並提問，
見 `docs/issues/2026-09-06-web-sprite-center-offset.md`。

## 決策後可指派的寫檔集合

core/API/digest 已完成本段可寫集合；下一段 host owner 可指派的寫檔集合應逐一
明確列出：`crates/unone-cli/src/main.rs`、`web/shared/webgpu-snapshot.js`、
`web/runner/main.js`、`web/runner/index.html`、
`crates/unone-web-live-smoke/src/main.rs`、
`platform/android/src/com/unone/android/UnoneActivity.java`。本代理不把 host
工作冒認為本段完成。
