# unone-animator：首位使用者需求 / 2026-09-09

## 授權與交付

使用者明確要求：如 Animator 有製作需求（動作漸變、播放器等），開需求給 Unone，讓其新增私人 repo `unone-animator` 供本遊戲使用。請建立獨立 **private** GitHub repo（沿用 Unone 的擁有者），完成最小可用插件與 browser runtime，再回傳 repo URL、確認的 visibility、commit、安裝路徑與可呼叫介面。這份文件是需求，不代表 repo 已建立。

這是 Unone optional plugin，不是 Codex plugin；依既有 `unone.plugin.v1`、EngineResult、CLI/MCP discovery、staging 安裝協定。保持 Core 凍結。若有無法由插件/renderer adapter 解決的通用引擎能力，另提最小需求及證據，不自行搬入遊戲規則。

## 已存在的使用者案例

消費端：`D:/Projects/YesSir/_Games/ashen-legion/wardrobe/`，http://127.0.0.1:8192/ 。Three.js 0.179.1，55 骨 Mixamo 名稱，真實 SkinnedMesh，同一 Skeleton 的五槽裝備，GLB 匯出再載入已測過；FBX retarget 55/55 映射已測過。

核心檔案：`rig.mjs`（createSoldier / makeClips / motionSpecs）、`app.mjs`（播放器）、`retarget.mjs`、`tests/verify.mjs`、`assets/ashen-soldier.glb`。

基本語意 ID：idle 站立、walk 移動、stretch 伸懶腰、attack 攻擊、death 死亡、spawn 出生；另有 run 和 tpose。現在切換呼叫 stopAllAction → skeleton.pose → 新 clip，造成硬切與姿勢跳動。UI 的 playing、action.paused、clampWhenFinished 狀態也散落各處，值得共用元件。

## P0：第一版必須能串接

1. **動畫播放器 runtime**：以宿主傳入的 Three namespace / mixer 或 adapter 建立 player，避免載入第二份 Three；輸入 root、clips、資料式 controller。提供 play/transition、pause/resume、restart、seek 秒數、speed、update(dt)、getState、dispose。名稱可調整，但請先回覆定稿契約。getState 應含 state、clip、time、duration、normalizedTime、playing、finished、transition source/target/progress。
2. **漸變**：預設 0.2 秒（可調）；Quaternion interpolation、權重歸一、不回 T-pose、不改 skeleton bind pose、不改装備。0 秒立即切換；不重新播放同一狀態，除非明確 restart。轉場中再次轉場須從當前混合姿勢連續接續，不能突然跳回前一 clip；淡出 action 要有有限生命周期，長時間切換不累積。
3. **循環與單次**：loop / once + clamp；end 事件每次播放只發一次。暫停不得推進動畫或漸變；seek 不自動 resume、不預設觸發 gameplay event。播完後 replay、seek、轉到其他狀態皆需可靠。
4. **資料式狀態設定**：可檢查與版本化 JSON，state 映射 clip、loop、speed、transition duration；可選 finished 後轉至指定狀態、exit time、允許打斷與 priority。插件只提供機制；例如 death 不可被 idle 打斷、spawn 完成進 idle，由遊戲自己的設定決定，不能寫死在 runtime。
5. **展示/檢查器**：可重用播放器 UI，state / clip 清單、播放/暫停/重播、時間軸、速度、loop、transition 秒數、來源/目標權重與進度；骨架透視可交給宿主。清楚顯示缺 clip、無效狀態、missing bone 等診斷。先支援本 browser 消費端，勿宣稱 native runtime 也已支援。
6. **可發現工具與文件**：建議 animator.inspect、animator.validate、animator.generate、animator.preview、animator.install（最終名稱可調整）。inspect 回 schema/範例/限制；validate 檢查 clip refs、狀態 target、數值範圍、重複 ID，指出 authoring JSON path。install 預設只寫 `.unone/staging/unone-animator/`，衝突明確回報；提供 CLI 自測、README 最小可執行範例和安裝 inventory/hash。

## 建議的消費形式（提案，尚非既定 API）

```js
const player = createAnimator({ THREE, root, clips, controller });
player.transition('walk', { duration: 0.2 });
player.update(dt);
const snapshot = player.getState();
player.pause();
player.seek(0.5); // 秒；不隱含恢復播放
player.resume();
```

遊戲以 Luau 的權威狀態/事件指定動畫意圖；browser adapter 處理視覺播放。動畫結束通知可供 Luau 消費，但插件不可自行判定傷害、死亡、出生、金錢、掉落或士兵壽命。五槽外觀替換也不得重置動畫時鐘。

## 驗收：請提供測試證據與消費端範例

- 站立→移動 0.2 秒漸變：初/中/末權重和約 1、頂點有限、無 bind-pose 跳變。
- 轉場未完成再次切至 attack：第一個 frame 姿勢連續；連續切換 100 次，active actions 不無限增加。
- 一次播放的完成事件、clamp、重播、播放中與完成後 seek、暫停時轉場時鐘停止；不同 dt 下同一時間位置一致（合理浮點容差）。
- 可設定 spawn 完成→idle；可設定 death 拒絕較低 priority 轉場；規則來自資料。
- 動作中換五槽，骨架 identity、時間和過渡狀態保留；GLB 的原始 clips 可繼續匯出（controller 另存 JSON，勿假稱 GLB 原生保存狀態機）。
- 真實 CLI plugin list / inspect / test / call、負例 schema、staging install 衝突、可離線 runtime 路徑都要實測。
- 首次先在本展示器的獨立 integration staging/demo 驗證。你負責插件 repo；此任務負責消費端接入，請勿並行覆寫本遊戲 app.mjs。

## P1：先留擴充點，避免拖延首版

上半身 bone mask / layer（跑步同時攻擊）、additive 呼吸與受擊、clip events、root motion 模式、Mixamo retarget 共用化。IK、foot locking、網路同步、複雜 blend tree、FBX exporter 不列為首版必要條件。
