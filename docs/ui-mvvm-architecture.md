# UI Manager / MVVM 架構提案

Current scope (2026-10-15): [ADR 0038](decisions/0038-shared-ui-styling.md)
extends the existing Core UI transport with shared typed font/box styles and a
decorative panel primitive. Use [the implemented style API](ui-styling.md) on
existing component leaves. This supersedes the earlier blanket "no new UI
primitive" restriction; it does not add MVVM, a manager, reactive bindings,
game-specific widgets or automatic layout to Core. The architecture proposal
below remains guidance for game/SDK responsibility and future lifecycle work.

這是建立在 [ADR 0004](decisions/0004-mvvm-presentation-boundary.md) 上的
UI 專用提案。四層是責任分法，不代表每個小畫面都必須建立四個檔案或四個
plugin。MVVM、UI Manager 與遊戲元件行為仍由 Plugin SDK、Luau 或 host adapter
承擔，最後投影到共用 Core UI transport。

## 四層各自做什麼

```text
Model ── domain state/rules ──> ViewModel ── serializable UI data/commands
                                      │
                                      ▼ explicit bindings
ViewProperties ── component declaration ──> View
                                      ▲
                                      │ mount/update/lifecycle
                              UI Manager / Layer
```

| 層 | 責任 | 不應該做 |
|---|---|---|
| **Model** | 遊戲/產品的真實狀態、規則、存檔、服務結果 | 讀取 UI widget、控制像素、知道 overlay stack |
| **ViewModel** | 將 Model 投影成可序列化 UI data；提供命名 command、prerequisite、result、diagnostic；產生 derived values | 直接改 View；藏網路/計時副作用；把 domain 規則搬到 Core |
| **ViewProperties** | 元件宣告：id、props、binding、events、placement、accessibility、runtime status | 持有 domain state；自行決定 action 的商業意義 |
| **View** | 把 ViewModel data 與元件綁定成 `unone.ui.v1` descriptor | 直接呼叫 ECS/Rust；偷偷建立全域訂閱 |
| **UI Manager / Layer** | screen mount/unmount、layer/overlay stack、focus/route、binding lifecycle、hot-reload safe-point | 保存遊戲真實狀態；替 Model 做決策；把 host 缺少的能力假裝存在 |

Model 與 ViewModel 是遊戲/應用程式 Luau；ViewProperties、View、Manager 可以
由 `unone-ui` SDK 提供預設實作，但仍由專案決定資料與 commands；Core 不需
知道這些層。

## 這是不是兩個新 plugin？

不建議一開始拆成兩個必裝 plugin。邏輯上可以有兩個 package，部署上先用
一個入口、兩個 namespace：

1. **UI foundation**：Manager/Layer、`ref`/`computed`/`reactive`、binding
   lifecycle、tree diff、hot-reload bridge、診斷與 overlay queue。
2. **UI components**：Button、Text、Panel、Tabs、Dialog、Toast 等
   ViewProperties、schema、generate/validate、host readiness。

Model、ViewModel 和各遊戲的 View 不應變成 marketplace plugin；它們是專案
原始碼，由 plugin scaffold/contract 協助產生。當 foundation 與 components
的版本、權限或替換頻率真的不同，再把兩個 namespace 拆成兩個 package。
AI 仍應只看見一個 capability entry，
由 manifest 表達 optional dependency，而不是自己猜安裝順序。

## Lua 的 reactive 方向

不要同時維護兩種互相競爭的 UI 架構。採用 Vue 風格的明確 reactive core，
以三個原語涵蓋大多數需要：

```luau
local state = reactive({ hp = 168, max_hp = 240, paused = false })
local break_percent = computed(function()
    return state.hp / state.max_hp
end)

local vm = {
    hp = state.hp,
    break_percent = break_percent,
    toggle_pause = command("TogglePause", function()
        state.paused = not state.paused
    end),
}
```

實際 SDK API 尚待實驗確認；語意應固定如下：

- `ref` 是單一值、`computed` 是唯讀 derived value、`reactive` 是有明確
  instance scope 的 table proxy；`computed` 不可反向寫入 Model。
- binding 是顯式且可移除的；不要建立全域 magic two-way binding。
- scheduler 必須掛在 Manager instance，順序 deterministic，reload/unmount
  會清掉舊 watchers、callbacks、commands。
- change notification 不應直接修改世界；command 回到 Model，View 只讀
  projection。這讓 headless test、replay 與 AI diagnosis 都能看到原因。

簡單畫面可以只用 plain table + `UI.view`；只有需要跨元件 derived data 或
多次更新時才引入 reactive。Reactive 是一個底層機制，不是第二套 React-like
rendering API。

## MessageBox、Hint、Loading、Toast 放哪裡

它們都屬於 presentation，但生命週期不同，應由 Manager 的 overlay/layer
服務統一管理，並使用與普通 View 相同的 ViewProperties contract：

| 元件 | 建議 owner | 重要契約 |
|---|---|---|
| MessageBox / Dialog | `ModalLayer` + ViewModel command | open token、title/body/actions、dismiss policy、focus trap、result/diagnostic |
| Hint / Tooltip | target View + host adapter | target id、trigger、placement、accessibility；hover/focus 不由 Core 假造 |
| Loading | `LoadingLayer` + ViewModel | stable id、phase、progress/indeterminate、cancel command；不把網路實作塞進 Core |
| Toast | `ToastQueue` | id、message、severity、duration frames、priority、dedupe、dismiss event |

MessageBox 的「是否開啟」與業務決定留在 ViewModel；Manager 負責 stack、focus
與安全點。Toast 可以由 command/notification 送入 queue，但不得成為隱形
全域 singleton。Hint/Tooltip 需要 host hit-testing/accessibility；目前
UnoneUI contract 將它標成 `host_required`。

## Hot reload、遠端錯誤、遠端更新

三種更新要分開：

| 更新 | 安全做法 | 目前方向 |
|---|---|---|
| View/VM script hot reload（開發） | shadow compile/check → safe-point swap；保留 Model 與 stable component state；失敗沿用上一版 | Unone runtime 已有 entry script reload；Manager 需再保留 binding/layer state |
| 內容/asset hot update | host fetch/cache → Core hash verify → staging → safe-point atomic generation → rollback | BundleManager/ Web store 已有 generation 與 rollback 邊界 |
| Core/native/WASM 更新 | 新 artifact 發佈、lockfile 選版、重新啟動或重新部署 | 不在遊戲 runtime 任意替換 binary |

View reload 的最小規則：stable `screen_id`/`component_id` 對齊就 reconcile，
focus、input buffer、overlay token 能保留；舊 instance 的 watcher/command
帶 generation，收到 stale event 必須拒絕。compile、schema、binding 或 host
capability 失敗時，保留 last-known-good View 並送出 diagnostic，不讓畫面
整個消失。

遠端錯誤 envelope 建議包含 `project_id`、package/artifact hash、host/target、
screen/component/binding id、UI generation、action、error code/path、safe
stack、input/replay reference 與 timestamp；必須去除帳號、token、原始個資。
遠端更新必須是簽章 immutable package：download 到 staging、驗 hash/compatibility、
使用者或 policy 批准、safe-point atomic switch，保留上一代供 rollback。遠端
服務可以是 Koncrate 或其他 backend，Core 只吃 host 提供的已驗證 bytes。

## AI 可追蹤工具契約

MVVM 如果只有分層而沒有觀測工具，AI 仍然只能猜「是哪一層壞掉」。因此
foundation plugin 必須一起提供以下 read-only／可重播工具；它們不是 Core
新增 API，也不應把 Model 的內部資料偷偷送到遠端。

| 工具 | 目的 | 最小輸出 |
|---|---|---|
| `ui.test` | headless 測試 Model→VM→binding→View 的語意與 descriptor | scenario、seed、input/replay、expected/actual snapshot、descriptor hash、diagnostics、pass/fail |
| `ui.replay_diff` | 比較兩次輸入或兩個 package 版本的結果 | replay id、first divergent step、Model/VM/View diff、binding/component source map |
| `ui.debug_snapshot` | 在安全點查看目前 MVVM 圖，不改狀態 | screen/layer stack、Model/VM generation、binding edges、watcher count、pending effects、last-known-good、redacted values |
| `ui.profile` | 量測更新與渲染前置成本，不假裝是 GPU benchmark | sample window、mount/update/unmount time、reactive invalidations、computed evaluations、descriptor diff size、listener/queue count、memory estimate |
| `ui.diagnose` | 將錯誤映回作者檔案 | error code/path、layer、source file/line、generation、replay reference、likely causes、suggested actions |

每個結果都應帶 `project_id`、plugin/package/artifact hash、host/target、
`screen_id`、`ui_generation`、`model_generation`、`view_generation`、
`binding_generation`、`correlation_id` 與 timestamp。錯誤 stack 要保留安全的
source map，不要把 token、帳號或原始個資放入 snapshot。

### 測試、除錯、效能的分工

```text
author change
    ↓
ui.test / ui.replay_diff ── semantic correctness + deterministic digest
    ↓
ui.debug_snapshot ───────── layer/binding/watcher/source-map location
    ↓
ui.profile ──────────────── cost evidence and declared budget comparison
    ↓
safe-point reload → preview → evidence record
```

- `ui.test` 是行為 gate；它必須能在沒有 GPU 的環境重播，並保留第一個
  divergent step，而不是只回傳最後的 `false`。
- `ui.debug_snapshot` 是 read-only 且要有明確 owner；每個 watcher、command、
  overlay token 都能追到建立它的 screen/component/binding。stale generation
  event 應明確列出並拒絕。
- `ui.profile` 先回報測量值，再與作者宣告的 budget 比較；不得把某台機器的
  guessed frame time 當成跨平台 verdict。至少要能看出 reactive invalidation
  是否造成不必要的全樹更新。
- hot reload 前後要各保存一次 debug snapshot 與 descriptor digest；若 compile、
  schema、binding 或 host capability 失敗，測試結果與 source map 必須指向
  rejected generation，畫面繼續使用 last-known-good。

這些工具可以由同一個 foundation plugin 暴露，也可以由 Editor/Workshop
包一層 facade；對 AI 仍應是固定名稱、固定結果 shape、固定 evidence 欄位，
不要要求 AI 解析不同語言的 log。

## 對 AI 會不會太重？

四層對人類架構是清楚的，對 AI 是否太重取決於是否要求 AI 手動接線：

- **不重的方式**：AI 只呼叫一個 `ui.mount`/`ui.bind` entry，先 inspect
  screen/component schema；Workshop scaffold Model/ViewModel/ViewProperties，
  AI 主要填 data、commands、props。小畫面可省略 Model 或 reactive。
- **會變重的方式**：四個 plugin、四種 manifest、隱形 two-way binding、
  AI 要自己管理 watcher 清理、overlay z-order 與 host fallback。這會增加
  token、失敗面與無法定位的 runtime state。

因此建議把四層當作穩定的概念模型，對 AI 提供單一 facade 與分層 diagnostics：

```text
AI: inspect screen → bind ViewModel → validate → preview/test → hot reload
       │                  │                    │
       └─ Manager facade ─┴─ explicit props/events ─┴─ evidence
```

評估是否保留四層的門檻：至少三個不同遊戲/應用重複需要 screen stack、derived
state、binding lifecycle 或 hot-reload preservation；若只有單一商店或對話畫面，
維持 plain Luau View + ViewModel，不能為了名稱增加 Core 複雜度。

## 實驗驗收項目

YesSir 可用三個情境做對照：王破防條（ProgressBar + computed）、派兵模式
（Tabs/Toggle + command）、武庫確認（Panel + Dialog + Toast）。每個情境比較：

1. plain table View 與 reactive View 的 AI 操作步數；
2. mount/unmount 後 Model 是否保留、舊 binding 是否清除；
3. View compile/schema 失敗是否保留上一版；
4. `ui.test` 是否保留 first divergent step 與 deterministic digest；
5. `ui.debug_snapshot` 是否能定位 screen/component/binding、owner 與 stale watcher；
6. `ui.profile` 是否能量出 invalidation、recompute、descriptor diff 與 listener 成本；
7. remote diagnostic 是否能沿 source map 定位原始檔案與行號；
8. signed update hash、safe-point switch 與 rollback 是否可重播；
9. host 缺少 IME、focus、hover 時是否 fail-closed。

實驗通過後才決定 foundation/components 是否各自發佈；目前先維持
[UnoneUI](https://github.com/Ovan741852/UnoneUI/blob/main/docs/platform-vision.md) 為可選 package，Core 不引入
UI Manager、reactive scheduler 或商店依賴。
