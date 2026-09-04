# Decision 0007：Camera2D 由引擎持有，follow policy 留在 Luau

## 決策

引擎持有 active Camera2D 的 position 與 zoom，並將 camera state 交給 renderer；Luau 透過 `camera.getPosition`、`camera.setPosition`、`camera.getZoom`、`camera.setZoom` 操作語意狀態。角色跟隨、鏡頭邊界、關卡切鏡與震動策略由遊戲端 Luau 決定。

## 原因

Camera projection 是跨遊戲、跨平台的引擎機制；follow target 與鏡頭劇情是遊戲政策。這個分界能讓 Angry Birds、AVG 與 RTS 使用同一個 camera contract，又不把特定遊戲的 player id 或鏡頭流程寫進 renderer。

## 最小範圍

目前只做單一 Camera2D、position、zoom 與 renderer 投影。多 camera、cinematic timeline、shake preset、3D camera 與 editor gizmo 要等驗證遊戲實際阻塞再加入。
