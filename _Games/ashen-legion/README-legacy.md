# 最新可玩規則狀態

本輪版本見 `RUNTIME-STATUS.md`。最新權威規則：破防只有抽獎機會，所有怪物皆可落空，已移除累積破防必中；聚寶甲蟲是四席共用池，成功開獎者領取全池；裝備／附魔增加每次派兵成本。新地點、商店、科技、附魔、藥水、詛咒、寶箱和約20分鐘七輪時間表已接入第一版 Luau。下方歷史截圖與測試結論不得當作目前版本驗收。

# 冥潮軍團 · ASHEN LEGION

第一版可玩原型。Unone Rust/WASM 執行 `main.luau`，Three.js 透過 Unone 的 `instances3d` 呈現原創低多邊形模型；HTML 介面讀取 Luau observation 並送入 InputFrame，不在 JavaScript 重寫戰鬥或抽獎。

## 遊玩

在引擎根目錄執行 `./Start-Game.ps1`。本機 Python 伺服器預設 [http://127.0.0.1:8190/](http://127.0.0.1:8190/)，僅監聽本機。

- 主畫面選正方形四邊中點其中一席 → 開局 → 三選一強化 → 戰鬥 → 通關後進入下一輪。
- 固定七輪，每關 90 秒。點住戰場向滑鼠方向連續派兵；`1 / 2 / 3` 切換兵種，`Space` 朝目前目標派兵，`Escape` 暫停。
- LOCK 點選怪物後持續追蹤派兵，僅命中該目標；AUTO 可篩選全部／小怪／王，自動換目標。
- 前 60 秒為小怪、小王與次王，最後 30 秒大王登場。小怪持續補充，前段定時補小王與次王。
- 每關 70% 機率在開戰後 22–45 秒觸發一次怪物潮，一次湧入最多 72 隻小怪，場上小怪上限 90 隻；正常破防、派彩與鎖定規則照常。
- 開獎倍率為獎金除以該部隊實付成本。金幣依獎級噴出 8／18／38／72 枚，先灑地再飛向玩家；大獎顯示 BIG WIN／MEGA WIN／LEGENDARY WIN。
- 出兵、拖尾、反彈、命中、開獎和大王登場皆有粒子；Bloom 與深度 SSAO 可獨立切換。
- 劍兵 8 幣、24 基礎傷害，命中即消耗。槍兵 20 幣、48 傷害，先投射最多 5.4 公尺，旋轉一圈造成 1.8 倍範圍傷害，再向前衝刺。騎兵 40 幣、90 傷害，穿透每個不同目標，4.2 秒後死亡。所有兵種撞牆會依入射方向反彈，反彈不重置壽命；劍兵與槍兵壽命為 5 秒。
- 破防條歸零後只抽獎一次，多餘傷害不會多抽。小怪抽一次即死。王的小獎／中獎留下怪物並重置破防條，大獎／特獎擊殺。
- 每回合結束，倖存部隊按派出時實付價格（含折扣）全額退回冥幣，只結算一次；到期死亡或命中消耗的部隊不退款。超時失敗也會結算倖存者，但不會因此改為通關。
- 冥王大獎或特獎即通關。資金低於最便宜部隊且場上無自己的部隊，或超時尚未擊殺冥王則敗北。
- 裝備可從神諭升階，每階兵種傷害 +30%；每兵種一格符文，燼火追加傷害、迴響增加獎金、凝霜命中緩速。選擇符文前可選擇安裝兵種。
- 開啟指南、武庫或切離視窗會暫停戰鬥。指南與武庫關閉後恢復先前狀態。

目前為單人模式，四邊中點保留四席佈局；尚未實作多人網路同步。七關共用獵場與模型，逐關增加破防與獎額。部隊使用靜態多邊形模型、程式位移與跳動，沒有骨架動畫。裝備升階與符文有數值效果，尚未製作各階外觀。無現金、付費或兌現功能。

## 初版數值

| 怪物 | 第一關破防 | 小獎 | 中獎 | 大獎 | 特獎 | 保底大獎 |
|---|---:|---:|---:|---:|---:|---:|
| 骸骨獵犬 | 22 | 16 | — | — | — | 一次結算 |
| 遊魂 | 40 | 28 | — | — | — | 一次結算 |
| 角魔督軍 | 100 | 38 | — | 160 | — | 第 5 次 |
| 冥河次王 | 160 | 65 | 140 | 360 | — | 第 6 次 |
| 灰燼冥王 | 240 | 100 | 220 | 650 | 1400 | 第 6 次 |

初始資金 320。每關破防增加基礎值 19%，獎金增加基礎值 14%。無幸運加成時，小王大獎 34%；次王大獎 23%、中獎 42%；冥王特獎 6%、大獎 20%、中獎 39%。保底優先於普通抽獎。初版偏向爽快的玩法驗證，尚未進行長期平衡。

## 原始碼與資產

- `main.luau`：全部遊戲規則和 seeded 隨機。
- `tools/build_art.py`：可重新產生三種部隊、四種怪物外形、場地與特效網格，需要 Pillow。
- `host.mjs`：Unone 網頁執行器接線、滑鼠射線投影、輸入與 render。
- `ui.mjs`、`style.css`、`index.html`：主畫面、HUD、神諭、結果、武庫及音效呈現。
- `assets/key-art.png`：生成的原創角色插畫；提示詞與來源見 [ASSETS.md](ASSETS.md)。
- `dist/web`：獨立網頁輸出，包含 Rust/Luau WASM、Three.js 與本機資產，不依賴 CDN。

## 重建

在引擎根目錄執行；Rust、Node、Python、Pillow 與引擎文件指定的 Emscripten/Binaryen 必須可用。

```powershell
cargo build -p unone-cli
python _Games/ashen-legion/tools/build_art.py
./scripts/build-web-live.ps1 -Player -Project _Games/ashen-legion
# export 要求新的輸出目錄。
./target/debug/game.exe --project _Games/ashen-legion export web --output _Games/ashen-legion/dist/web-new
node _Games/ashen-legion/tools/finish_export.mjs _Games/ashen-legion/dist/web-new
python scripts/serve-player.py _Games/ashen-legion/dist/web-new --port 8191
```

現有輸出的遊戲腳本／介面更新可執行 `node _Games/ashen-legion/tools/finish_export.mjs`。模型或宣告變更應重新 export。不要把不同版本執行檔與新 HostProject 混用。

## 驗證

```powershell
./scripts/install-luau-analyze.ps1
./target/debug/game.exe --project _Games/ashen-legion bundle pack
./target/debug/game.exe --project _Games/ashen-legion verify --json
node --experimental-wasm-exnref _Games/ashen-legion/tools/playtest.mjs
node --experimental-wasm-exnref scripts/verify-host-parity.mjs --export _Games/ashen-legion/dist/web --fixture _Games/ashen-legion
```

已通過 strict Luau 檢查、嚴格資產檢查、21 個原生輸入重播案例，及這 21 案例的原生／WASM 最終 observation digest 一致檢查。三個固定 seed 的兵種策略在真實 WASM 中共完成 21 關，逐 tick 驗證資金守恆，見 `tests/playtest-report.json`。自動測試只送正常輸入，未改金錢、傷害、時間或抽獎。

DOM 介面不使用引擎 UI tree，因此引擎 layout gate 為不適用；主畫面、神諭、戰場、部隊切換、派兵扣款及武庫另以實際瀏覽器操作檢查。這些測試不代表網路多人或長期數值平衡已完成。

反彈／回收更新另涵蓋四角雙軸反彈、反彈不延長壽命、死亡不退款、超時倖存者退款一次，以及折扣派兵按實付價格退款。21 關策略逐 tick 檢查資金、部隊數、派兵費用守恆與部隊仍在場內。


## 森林場景／四邊炮台更新

戰場為 14.8 × 14.8 的正方形，四座炮台在南／東／北／西邊中點附近
(0,7.1)、(7.1,0)、(0,-7.1)、(-7.1,0)。發射、瞄準、金幣回收與
炮台模型共用這些位置；中央沒有炮台。反射仍有邏輯邊界，但不繪製框線、
圍牆或連續石頭邊框。森林、溪流與植被自然延伸到場外。

`environments.json` 分離場景設定，可從主介面右上切換晨光／暮色森林。
六面天空盒由 `tools/build_sky.py` 產生，是真實 3D skybox mesh 與貼圖，
不是截圖背景。兩個時段目前共用森林地形；後續場景可替換 arena/sky 資產。

重新產生：先 `python tools/build_art.py`，再 `python tools/build_sky.py`，
最後 `node tools/finish_export.mjs`（以上在遊戲資料夾執行）。森林場景幾何
在 `tools/forest_art.py`；此次沒有改動角色紙娃娃資產。

新佈局驗證：`node tools/verify-forest.mjs` 使用真實 Unone WASM，四個位置
各驗證正方形尺寸、出兵座標，並持續檢查金錢／部隊守恆及活動邊界。
日間與暮色均以實際瀏覽器繪製截圖。前面 21 案例的通過紀錄屬原四角版；
本次沒有宣稱舊角落專用重播或原兵種通關策略仍符合新佈局與經濟平衡。
