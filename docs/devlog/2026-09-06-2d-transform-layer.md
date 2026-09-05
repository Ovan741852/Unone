# 2026-09-06：2D transform / sprite layer core

狀態：`engine_verified`；主代理已審查，Claude review 待額度恢復補做。
製作代理：Luna / max。整合證據見 `2026-09-06-digest-integration.md`。

## 契約來源

使用者已正式決定「碰撞體獨立設定」，已記錄於
[Decision 0034](../decisions/0034-independent-2d-colliders.md)。因此本次
`rotation`/`scale` 是 visual-only：不改 rigidbody radius、mass、velocity、
position integration、contact 或 ground contact；本次也不新增 angular velocity、
angular collision、scene graph 或 animation transform。

本工作以 `d7cae90` roadmap #2/#3 為規劃基準，沒有建立分支、worktree、commit
或 push。

## 本段實作

已修改：

- `crates/unone-engine/src/world.rs`
  - 保留 `SceneEntity.transform` 的 `{x,y}` position shape。
  - 新增 entity-level `rotation: f64`（radians，y-up 正角 counter-clockwise）
    與 `scale: Vec2`（預設 `(1,1)`，只能正且 finite）。
  - 新增 `Transform2DData { position, rotation, scale }`，及
    `World::get_transform2d` / `World::set_transform2d`。
  - 新增 `SpriteData.layer: i32`，預設 `0`；snapshot 明確帶 rotation、scale、
    sprite layer。
  - scene load 先完整驗證再改 physics/camera/entities；invalid 2D transform
    不留下部分 world。
  - `World::step_physics` 未使用 visual rotation/scale；加上 defaults、
    serialization、invalid update、physics independence tests。
- `crates/unone-engine/src/runtime.rs`
  - 新增公開 `observation_digest(&WorldSnapshot) -> Result<String,
    serde_json::Error>`；直接對已生成 snapshot 做 `serde_json::to_vec`，沿用
    `sha256:` + 小寫 hex，真正的 serialization error 會往上傳遞，不能以空
    buffer 假造 digest。
  - `EngineRuntime::run_internal` 改呼叫同一 helper；失敗時回傳
    `OBSERVATION_SERIALIZATION_FAILED`。helper 不額外 observe/tick，也不改
    seed/time；run 本身原有的推進行為不變。
  - 接上 `entity.getTransform2D` / `entity.setTransform2D` binding；getter 讀取
    呼叫當下的 world state，setter 完整驗證後原子更新 position/rotation/scale。
  - 加入同 seed/input、固定 120 frames 的 runtime regression；visual-only
    scene 差異會出現在 snapshot/digest，但 physics fields 與 contacts 不變。
  - 加入 helper byte-definition、不同 snapshot state、read-only，以及 2D Luau
    API smoke tests。
- `crates/unone-engine/src/lib.rs`
  - re-export `Transform2DData` 與公開 root `observation_digest`，供 Web host
    直接接線。
- `crates/unone-engine/src/api.rs`
  - 新增 `entity.getTransform2D` / `entity.setTransform2D` descriptors，並將
    getter 說明校正為「呼叫當下」。
- `crates/unone-engine/src/engine.d.luau`、`docs/engine.d.luau`
  - 同步 `Transform2D` 與 EntityApi members；docs copy 同時補齊原本缺少的
    `despawn` / `setSpriteVisible`。
- `docs/scene.schema.json`
  - 加入 `$defs.scale2d`、entity rotation/scale defaults、sprite signed32 layer
    bounds 與 collision-independent 說明。
- `docs/work-packages/2026-09-06-2d-transform-layer.md`
  - 記錄 serialized shape、API 名稱、單位/pivot、排序、owner、replay/save/digest、
    host gates、package-only Angry Birds 盲測計畫與已 resolved 的 blocker history。

實際 shape：scene/snapshot 保持 `transform: {x,y}`，新增 sibling
`rotation`/`scale`；`sprite` 新增 `layer`。Luau aggregate API 名稱為
`entity.getTransform2D` / `entity.setTransform2D`，型別為
`Transform2D { position: Vec2, rotation: number, scale: Vec2 }`。host 的排序鍵
是 signed numeric `(layer)` ascending，再以 entity id UTF-8 bytes ascending
作同層 tie-break；低 layer 先畫，後畫者在上。

## 驗證

結果：主代理已回報 workspace tests：engine 82、web 4、cli 6、mobile 8，
以及 wasm build 均通過。此前本代理 targeted world per-frame physics
invariance、observation digest、2D Luau binding tests 均通過；doc-tests 0
tests 通過。

曾實跑以 `math.huge` 誘發 serialization error；本版 serde_json 對非有限
float 回傳 `Ok`/`null`，未為測試改 serialization 演算法，因此移除該假設測試。
production helper 仍用 `?` 傳播真正的 `serde_json::Error`，`run_internal` 只有
收到 `Err` 才 failure。

這些是 engine unit/runtime evidence，不是 native/Web/Android 畫面證據。

## 尚未開始的 production / host code

下列不屬於 core 製作代理的寫檔範圍（不代表平行的 Web 工作沒有修改）：

- `crates/unone-cli/src/main.rs` native preview。
- `web/shared/webgpu-snapshot.js`、`web/runner/main.js`、
  `web/runner/index.html`、`crates/unone-web-live-smoke/src/main.rs`。
- `platform/android/src/com/unone/android/UnoneActivity.java`。
- `crates/unone-engine/src/diff.rs`；本段沒有修改 recording schema version。

`api.rs::typings()` 以 `include_str!("engine.d.luau")` 嵌入
`crates/unone-engine/src/engine.d.luau`；首次 review 發現原授權清單漏列這個
canonical source，會讓 type、runtime 與 descriptor test 無法同步。主代理已
補正寫入範圍，本段已同步 canonical source、descriptors/runtime binding 與
`docs/engine.d.luau`，未改 include path。`[BLOCKER] CORE-TYPINGS-WRITE-BOUNDARY`
已 resolved。Web #14 的 canonical digest「抽出」也已決定並由本段完成 root
helper，Web 代理只需接線。

另一製作代理可改 `web/runner/main.js`、`web/runner/index.html`、
`crates/unone-web-live-smoke/src/main.rs`；本段遵守邊界，沒有碰這些檔案，也沒有
做全 repo formatter。

## 下一個 gate

主代理先 review core/API/digest 固定 diff，再由 owner 另派 native、Web
shared/DOM/live、Android host。各 host 要實測 rotation/scale center pivot、scale
到 sprite size、`(layer,id)` sort、visible handling 與 y-down angle conversion；
host 完成前不宣稱跨平台完成。

package-only Angry Birds 盲測只在 package 重新產出並經 core/API review 後執行；
本階段未指派/未執行遊戲盲測，因此沒有冒充遊戲或 host 實跑證據。

## 待使用者決定

Core 的碰撞獨立語意、canonical typing 寫入範圍與 Web digest 抽出均已確認。
整合時另有 Web sprite 中心偏移待使用者決定，見對應 issue；不阻擋 core 提交。

## 決策後可指派的寫檔集合

下一段按 owner 指派 `crates/unone-cli/src/main.rs`、
`web/shared/webgpu-snapshot.js`、`web/runner/main.js`、`web/runner/index.html`、
`crates/unone-web-live-smoke/src/main.rs` 與
`platform/android/src/com/unone/android/UnoneActivity.java`；這些 host gate
不是本段已完成內容。
