# Decision 0019: semantic observation is the MVVM projection boundary

日期：2026-09-05  
狀態：accepted（AVG validation slice；UI renderer pending）

## Context

AVG 的對話狀態不是 Transform 或 physics component，AI 也不能只靠截圖確認分支是否正確。若讓遊戲端再維護一份 engine 可讀的鏡像資料，會造成 state drift；若把 DialogueViewModel 塞進 Rust，則 engine 會開始擁有遊戲業務。

## Decision

引擎提供唯一必要的 `api.observation.set(key, value)` primitive：

- Luau 遊戲端擁有 Model、ViewModel、流程與 command policy。
- ViewModel 以明確 typed Luau 結構建立，再在發布邊界轉成有限制的 JSON-like observation。
- engine 只保存每個 key 的最新可序列化投影，放入 `WorldSnapshot.observations`，供 CLI、MCP、Web/mobile host 與 test assertion 讀取。
- 支援 string、number、boolean、nil、string-key object 與連續 positive-integer array；拒絕 function、userdata、非有限數字、混合 key 與超過深度上限的值。
- observation 不是第二份可寫 gameplay state；它不能反向驅動 ECS，也不做全域 ViewModel registry。
- `:: any` 只允許在 typed ViewModel → dynamic serialization boundary，不能擴散到業務規則。

## MVVM boundary

```text
Luau Model / game rules
        ↓ typed selector
Luau ViewModel
        ↓ observation.set (explicit serialization boundary)
Engine semantic observation → AI/test/host
        ↓ later, when proven necessary
Engine UI primitives / View
```

這讓 AI 可以直接比較 `view_model` JSON 與 deterministic input，而不用猜畫面座標。真正的 declarative View、button hit-test、save/load 仍需由 AVG 或其他遊戲的實際阻塞證明後再加入；本決策不預先建立 UI framework。

## Consequences

- `WorldSnapshot` 的 observation 欄位會讓 Web/native/headless 使用同一個語意狀態出口。
- Test manifest 可以對 observation key 做完整 JSON equality assertion，測試仍留在遊戲端。
- observation 大小、更新頻率與內容由遊戲端負責；引擎只做 depth/type guard，不承諾任意 VM heap serialization。
