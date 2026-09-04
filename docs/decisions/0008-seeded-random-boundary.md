# Decision 0008：seeded random 是引擎 primitive，隨機規則留在遊戲端

## Context

長期驗證包含自走棋、老虎機、魚機與放置戰鬥；AI 需要能重播同一個 seed 與輸入。原本 `RunReport.seed` 只記錄 metadata，並沒有真的影響 runtime。

## Decision

- Rust runtime 持有 deterministic RNG state，seed 在 runtime 建立時注入。
- Luau 只看到 `api.random.nextFloat()` 與 `api.random.nextInt(min, max)`。
- `nextInt` 是包含兩端的整數範圍，拒絕 `min > max`，並用 rejection sampling 避免 modulo bias。
- 分布、抽卡權重、slot reel、魚群規則與遊戲結果判定留在 Luau；引擎不提供遊戲專用 random system。
- 相同 seed、input sequence 與 random call order 才是 deterministic replay 的必要條件。

## Consequence

這讓 headless tests 可以驗證隨機遊戲規則，又不把各遊戲的機率設計塞進 engine。未來若加入 network 或非同步工作，仍需把 scheduling／network mock 納入 deterministic contract；不能只依靠 seed。
