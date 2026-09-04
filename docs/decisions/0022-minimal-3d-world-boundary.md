# Decision 0022: 3D 只加入被驗證需要的 world primitives

日期：2026-09-05  
狀態：accepted（3D Racing validation slice）

## Context

七類 final-gate 中的 3D Racing 首次要求引擎能表達 3D 世界；現有 engine 只有 2D transform、sprite 與 camera。若暫時把 3D 座標全藏在遊戲端 observation，便無法驗證 native/Web/mobile 共用的 3D runtime contract；若一次加入完整 scene graph、material、animation、vehicle physics 與 asset editor，則會超出「引擎只負責必要的」邊界。

## Decision

第一個 3D contract 只包含：

- `Vec3`
- `Transform3D`：position、radian Euler rotation、positive scale
- `Mesh3D`：asset id 與 visible flag
- `Camera3D`：position、target、fov
- Luau 的 `entity.getTransform3D`、`entity.setTransform3D`、`camera3d` read/write API
- snapshot 與 semantic diagnostics

native preview 目前只提供不依賴真實 asset 的 debug cube 透視投影，供檢查 transform/camera 是否真的跨過 runtime 到 host；它不是最終 asset renderer。

## Ownership

| 能力 | 引擎端 | 3D Racing 遊戲端 |
|---|---|---|
| 3D state transport/validation | Vec3、Transform3D、Mesh3D、Camera3D | 車輛狀態與資料語意 |
| movement | transform primitive | 加速、轉向、圈數、進度 |
| vehicle physics | 尚未加入 | 目前用 Luau 規則驗證，直到多遊戲證明需要 |
| camera policy | Camera3D state | 追車位置與 target |
| presentation | host projection primitive | ViewModel、UI tree、內容 |

不因為 3D Racing 單一需求加入車輛、賽道、輪胎、material、prefab、navigation 或完整 3D physics API。若 Red Alert RTS 或其他 final-gate 再次提出相同且語意一致的低階阻塞，先更新 decision 與 evidence，再提煉最小共同能力。

## Consequences

- 同一份 Luau game code 可以先在 headless 驗證 3D state，再交給 native/Web/mobile host。
- 3D contract 有明確失敗邊界：沒有 Transform3D、無效 scale、缺 Camera3D 都會回傳 semantic runtime error。
- 真實 mesh/texture、深度 buffer、lighting、3D collision 與 production asset streaming 尚未宣稱完成，必須由後續驗證推動。
