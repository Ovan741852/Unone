# 玩家鏡頭 · 2026-09-10

遊戲呈現配置，沿用官方 PerspectiveCamera，不更改引擎或戰鬥規則。

垂直 FOV 50 → 66 度；位置 (0,14,20) → (0,8.5,15.5)，看向場中央。隨 P1–P4 席位旋轉，所選炮台保持畫面下方中央，呈現從炮台向森林場內展開的廣角視野。方形場地與碰撞不變。

host.mjs 的怪物標籤投影與滑鼠地面射線改用 renderer 實際 camera3d，移除原固定 50 度手算投影，避免 FOV 或席位變更後瞄準錯位。

驗證：verify-formal-ui.cjs 真實 Canvas 流程通過；verify-player-camera.cjs 在遠端 HTTPS 驗證四席炮台置中與前景位置、四席滑鼠瞄準世界座標誤差小於 0.02，無 page error。證據 tests/player-camera.json、player-fov.png。
