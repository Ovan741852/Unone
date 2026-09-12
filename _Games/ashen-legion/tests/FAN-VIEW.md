# 扇形視覺 · 2026-09-10

依使用者確認，Luau 方形場地與碰撞仍為 17 × 17。presentation/fan-view.mjs 是此遊戲的視覺變形：依席位轉成左右／前後座標，遠側展寬、近側收窄；高度不變。沿用 Three 材質 shader hook，Unone core 未修改。場景、部隊、城牆及世界特效共用變換；正式 UI 不變形。

host 的標籤投影先做同一變換；滑鼠地面射線做反向變換，再交回 Luau。反彈仍按正方形世界座標計算。角色橫向比例會隨深度改變，屬刻意的風格化呈現。

verify-player-camera.cjs 在遠端 HTTPS 驗證四席遠牆螢幕寬度大於近牆 1.2 倍、炮台置中、瞄準反算誤差小於 0.02，以及無瀏覽器／shader console errors。
