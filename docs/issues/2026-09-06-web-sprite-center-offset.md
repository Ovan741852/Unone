# Web DOM 貼圖中心偏移

日期：2026-09-06。狀態：awaiting_user_decision。分類：host / rendering logic。

## 重現與根因

以重新編譯的 wasm 開啟 generic runner，使用 AngryBirds2D source mode。
紅鳥 DOM 貼圖位於同一 entity 的 WebGPU 方塊上方，而非中心重合。

`web/runner/main.js::renderAssets` 用 `bottom = view.y%` 定位；
`web/runner/index.html` 的 `.unone-asset-sprite` 卻使用
`transform: translate(-50%, -50%)`。bottom 指定的是底邊，再向上平移
半個高度，導致圖片中心比預期向上偏移一個完整 element 高度。
此 CSS 已存在於本輪基準 `5ae821e`，不是 digest 抽出引入。

觀測到紅鳥 element 高度 30.28125 CSS pixels；證據見
`docs/evidence/2026-09-06-web-semantic/runner-digest-and-offset.png`。
截圖中其他目標在取景外並不在本 issue 中判為引擎 bug；遊戲本身會追蹤紅鳥相機。

## 影響與待決

影響一般 Web DOM sprite 的視覺中心、點選判讀，以及下一段 rotation/scale
中心 pivot 驗收。不影響 Rust physics 或 observation digest。

已詢問使用者是否併入下一段 2D host 工作。建議修正 bottom-based 中心定位
的 Y 平移方向，並驗證未旋轉和旋轉/非等比縮放時的中心一致性；不改遊戲位置
去補償 host 錯誤。答覆前不修改此 CSS。
