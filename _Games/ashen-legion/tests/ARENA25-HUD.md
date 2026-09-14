# 25 × 25 與精簡戰鬥介面

依使用者指定，Luau 碰撞半徑 12.5，炮台位於四邊中點 ±12.2。森林、怪物活動與出生、怪物潮分布同步放大；部隊費用／速度／壽命不變。扇形視覺與鏡頭取景同步到新範圍，底座位置為畫面高度 88%、遠牆外角為寬度 1% / 99%、高度 28%。

參考已實際檢視的 TaDa 官方《獵龍大亨 II》主遊戲圖：
https://tadagaming.com/zh-CN/PlusIntro/DinosaurTycoonII
https://wbgame.tadagaming.com/All-In-One/production/img/tadaPlusPlayer/games/TaDa_games_descImage_212_en-us_5.webp

參考重點：戰場佔滿畫面、小型餘額牌、側邊模式操作。移除全幅 hud_bottom，新增三張原創 SVG/PNG（hud-key、hud-active、hud-gold）；左下兵種及本機席位，炮台下方金幣小牌，右側手動／LOCK／AUTO及目標篩選。全部沿用官方 Unone UI，沒有 DOM 遊戲控制項，沒有拷貝參考圖資產。

四席投影與三尺寸錨點、實際 Canvas 點擊（買裝、換裝、手動按住、LOCK/AUTO、暫停）、Luau strict 型別通過。沿邊射擊測試位置遷移到 12.2/12.4，反彈測試增加 21 幀對應新增距離，原斷言不變。完整長局平衡尚未重跑。
