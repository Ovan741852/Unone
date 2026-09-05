# Decision 0031：鏡頭必須宣告它看得到多少世界

日期：2026-09-05

## 背景

`Camera2D` 只有 `position` 與 `zoom`，而 `zoom` 是一個**沒有基準的乘數**：引擎從來沒說一個畫面看得到多少世界單位。結果三個 host 各自發明常數：

```
-0.8 + (x - camX) * 0.2 * zoom
```

原點被放在畫面左側 10%、底部 45%，而且世界方塊會被 clamp 在邊緣、sprite 卻不會，兩者互相矛盾。憤怒鳥因此三個 sprite 有兩個畫在畫布外，同時方塊擠成一團——這不是渲染 bug，是契約缺口。

更根本的是：**「這個東西在畫面內嗎」這個問題目前沒有答案可言**，所以任何世界層的檢查工具都只能猜，會重蹈 `UI_TEXT_EXCEEDS_RECT` 的覆轍。

## 決定

`Camera2D` 新增 `view_height`：**zoom 1 時垂直可見的世界單位，以 `position` 為中心**。可見高度是 `view_height / zoom`，可見寬度是它乘上 host 的 viewport aspect。預設 `10.0`，正好等於所有 host 先前寫死的比例，因此沒宣告的場景維持原本的縮放。

投影收斂成一份共用實作：

- Web：`web/shared/webgpu-snapshot.js` 匯出 `worldToView`／`viewToWorld`／`worldSizeToView`，runner 的 sprite 與世界方塊、pointer 反投影全部走它。
- Native preview：同一個公式。

實體一律**以自身為中心**繪製，而且**不再 clamp**：畫面外的東西就畫在畫面外。夾邊會把「取景錯了」偽裝成「東西擠在角落」。

## 邊界

這只定義 2D 正交取景。它不處理 letterbox、safe area、多鏡頭、rotation 或 3D；`Camera3D` 仍有自己的 fov。UI 層完全不受影響，它有自己的 0..100 設計空間。

## 原因

- 三個 host 對同一個場景框出不同結果，是最貴的一種不一致：遊戲作者在一個 host 調好，換一個就錯。
- 沒有視野宣告，世界層就無法有任何客觀的檢查工具。這是 Decision 0029 立下的入場條件之一：缺事實時補契約，不要猜。

## 已知限制與下一步

- 現有遊戲的鏡頭都是照舊投影調的。憤怒鳥已改為 `view_height: 12` 並置中；其他遊戲若之後看起來取景不對，是同一個原因。
- 世界層仍然沒有 ASCII 地圖與 offscreen 檢查——現在契約齊了，那是下一步。
