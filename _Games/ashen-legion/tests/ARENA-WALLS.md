# 碰撞城牆

presentation/arena-walls.mjs 以遊戲 observation.arenaHalfExtent 建立低模石牆；內側表面精確落在 ±8.5，即 Luau 反彈平面。牆身向場外延伸 0.36，主牆高 0.4、垛口最高 0.66，四角矮柱。僅遊戲美術呈現，不另建物理規則。

verify-player-camera.cjs 遠端 HTTPS 驗證四席投影及城牆內側與 authoritative extent 一致。arena-walls.png 為實際遊戲截圖。
