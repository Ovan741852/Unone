# Decision 0028：Spine 與 Effekseer 是語意狀態，不是引擎 runtime

日期：2026-09-05

## 背景

老虎機、RTS、放置戰鬥都需要骨骼動畫與特效。Spine 與 Effekseer 是這兩件事的既有解法，但兩者都是各平台的 C/C++ runtime，Web、native、Android、iOS 的實作與授權條件都不同。若把它們塞進 engine core，引擎就同時承擔了骨骼求值、粒子模擬與四個平台的 renderer；若完全不管，遊戲又只能在腳本裡自己維護一份沒人看得到的動畫狀態。

## 決定

引擎只擁有語意狀態與 determinism，host 擁有 runtime。

**Spine（system `spine`）**

- scene entity 新增可選 `animation`：`{asset, animation, loop, speed}`。
- `api.animation.play(id, name, options?)`、`api.animation.stop(id)`。
- snapshot 的 `world.entities[].animation` 額外帶 `started_frame`。重複播放同一組 asset/name/loop/speed 不會重設 `started_frame`，因此 host 不會每 frame 重新開始播放。

**Effekseer（system `effekseer`）**

- `api.effect.spawn(asset, options?) -> handle`、`api.effect.stop(handle)`。
- snapshot 的 `world.effects` 是目前存在的特效實例：`handle`、`asset`、`position`、`scale`、`rotation`、`started_frame`。handle 依建立順序決定，因此相同輸入產生相同 handle；同時存在上限 256 個，超過會失敗而不是無聲成長。

**資產**

- asset manifest 新增 kind `spine` 與 `effekseer`。
- `AssetSpec` 新增可選 `files`：這個資產不可缺少的附屬來源（Spine 的 atlas 與 texture page、特效的貼圖）。它們與 source 打進同一個 bundle，引擎不解析內容。
- `game asset read --id <id> --file <declared file>` 讀取已宣告的附屬檔案；未宣告的檔案回報 `ASSET_FILE_NOT_DECLARED`。

**測試**

- 新增 `animation` 與 `effects` assertion，做完整 JSON equality，和既有的 `observation`／`ui` 同一個習慣。表現狀態因此可以被 assertion，而不是靠截圖判斷。

兩個 system 預設關閉，狀態是 `host_required`：引擎這一半可用，但目前沒有任何 host 會畫出 Spine 骨骼或模擬粒子。

## 邊界

引擎不評估骨骼、不做動畫混合、不回報動畫是否播完、不模擬粒子、不管理特效生命週期、不決定 draw order，也不內含任何 Spine 或 Effekseer 程式碼與授權。遊戲若需要「動畫播完後才結算」，必須自己以 fixed frame 計算，不能問引擎。

## 原因

- 這兩件事的共同點是「遊戲決定要播什麼，平台決定怎麼畫」；把邊界切在這裡，四個 host 可以各自實作而不改遊戲。
- `started_frame` 與 deterministic handle 讓表現狀態進入 observation digest，reload 與重播都能對齊。
- 先有可驗證的語意層，才有辦法判斷之後真的需要哪些 runtime 能力；反過來先綁 runtime 會把授權與平台差異寫死在 engine core。

## 已知限制與下一步

- 沒有任何 host 播放：native preview、Web runner 與 Android host 都還不會畫 Spine 或 Effekseer。本輪不得說成「支援 Spine／Effekseer」。
- 老虎機驗證專案的 Spine 與 Effekseer 資產是明確標示的 placeholder 檔，只用來走通 asset／bundle／archive 契約，不是真實美術資產。
- 動畫事件（例如 Spine 的 event timeline）與特效播完通知都還沒有契約。
- 下一步是讓 Web runner 先接上 spine-webgl 與 effekseer.js，用同一份 snapshot 播放，再回頭判斷語意層缺什麼。
