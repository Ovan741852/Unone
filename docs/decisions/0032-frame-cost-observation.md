# Decision 0032：引擎必須說出一個 frame 的時間去哪了

日期：2026-09-05

## 背景

引擎可以驗證正確性（型別、資產、版面、deterministic 測試），但**完全無法回答「為什麼這款很慢」**。`run` 回報 frame 數、digest、trace，沒有任何一個時間或計數。

看不到畫面的作者已經靠 `ui preview` 得到補救；**量不到成本的作者沒有任何補救**：它只能猜哪裡慢，而猜測正是這個引擎一直在消滅的東西。

## 決定

`RunReport` 新增 `performance`，並提供 `game perf` 與 MCP `unone_perf`。

回報的都是引擎擁有的事實：

- 三個階段的時間與占比：`script`（Luau update）、`physics`、`observe`（快照與序列化）。
- frame time 的 mean／median／p95、最慢的那一格是第幾格與它的階段拆解。
- 超出 fixed timestep 預算的 frame 數，以及以平均值換算的 sustained fps。
- Luau heap 大小。
- 一個 frame 裝了多少東西：entity、rigidbody、UI 節點、effect、observation。

兩個硬性性質：

1. **量測是 wall clock，絕對不進 `WorldSnapshot`**，因此不進 observation digest。量效能不可以改變一次 run 的意義。這是可驗證的：加入量測前後，同一個 seed 的 digest 完全相同。
2. **只給數字，不給判決。** 依照 Decision 0029 的入場條件，「夠快」需要引擎不知道的目標，所以引擎不宣告及格線。`frames_over_budget` 是拿 fixed timestep 當參考點的事實陳述。

## 邊界

沒有 per-entity 或 per-system 的細分：引擎目前只有這三個階段是真實存在的邊界，硬切更細只會產生看起來精確、實際上是猜測的數字。沒有 GPU 時間——那在 host。沒有火焰圖、沒有取樣剖析器。

## 原因

- 階段邊界是引擎擁有的事實，因此這份報告不需要猜任何常數。
- 「script 占 97%」這種單一數字，就足以讓作者知道該去看 Luau 而不是引擎——這正是最常見的誤判方向。
- 計數與時間放在一起，成本才能對照規模來讀。

## 已知限制與下一步

- debug build 量到的是 debug 成本；跨版本比較必須比同一種 build。引擎不會替使用者判斷這件事，只在報告裡陳述。
- 還沒有「兩次 run 的差異」工具：作者可以看到現在多慢，還不能看到「跟上一版比慢在哪」。那是除錯軸的下一步。
