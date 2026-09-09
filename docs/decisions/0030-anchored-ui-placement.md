# Decision 0030：貼邊定位用具名 anchor，單位只有一種

日期：2026-09-05

## 背景

UI 設計空間是 0..100 × 0..100，由 host 拉伸到 viewport。這在單一 16:9 的情況下沒問題，但一份宣告換到直式螢幕就會失真：`x: 80, width: 15` 的按鈕在 16:9 正常，在 9:16 會變成又寬又扁。

作者看不到畫面，**永遠不會發現**。這與 layout gate 抓到的問題同一類：引擎沒有描述能力，缺口就只能靠人眼補。

## 決定

節點的位置二選一，`rect` 或 `anchor`，同時宣告或都不宣告都是錯誤。

```json
{
  "kind": "button", "id": "spin", "text": "Spin", "action": "Spin",
  "anchor": "bottom_right",
  "offset": { "x": 4, "y": 4 },
  "size": { "width": 30, "height": 10 }
}
```

- `anchor` 是九個具名位置之一。**具名是重點**：看不到畫面的作者選一個詞的正確率，遠高於填四個互相牽動的正規化浮點數，那正是各家 RectTransform 式 anchor 系統要求的東西。
- `pivot` 可選，預設等於 `anchor`。
- **所有數字都是垂直單位**：畫面高度的百分比，兩個軸都是。作者因此永遠不必推理 aspect，而且盒子換螢幕不變形。引擎在 x 軸除以實際 aspect。
- `offset` 的方向由 anchor 決定：貼右邊就往左推，貼上面就往下推。

引擎在 `api.ui.setRoot` 時解析成 0..100 的 rect，所以 **host 收到的仍然是純 rect**：排版只有一份實作、可以被測試釘住，layout gate 與 UI assertion 都不用改。

host 以 `EngineRuntime::set_viewport_aspect` 或 wasm 的 `unone_web_set_viewport_aspect` 回報實際比例；沒有回報的 host 得到 16:9 參考版面，headless 測試也用它。

## 邊界

這不是 flexbox，也不是 RectTransform 的完整移植：沒有 stretch anchor（anchorMin ≠ anchorMax）、沒有 margin 塌陷、沒有自動排版。現在允許 `component` 包住可重用子節點，但子節點仍使用 screen design space，不建立 local transform 或隱式排版。絕對 `rect` 保留給網格表達不了的版面。

## 原因

- 貼邊是語意，百分比不是。`bottom_right` 這種詞 AI 盲寫會對，`x: 82.3` 不會。
- 單一單位系統消滅了整類 aspect 錯誤。混用 x%/y% 的系統要求作者心算螢幕比例，那是人類都會寫錯的東西。
- 在引擎解析而不是在 host 解析，讓三個 host 不必各自實作一次排版——這正是世界層投影踩過的坑。

## 已知限制與下一步

- 現有驗證遊戲仍全部使用絕對 `rect`；anchor 目前沒有實際遊戲在用，因此還沒有跨比例的實戰證據。
- 世界層（`Camera2D`）仍然沒有視野宣告，三個 host 各自發明投影。那是下一個要補的契約缺口。
- native preview 與 Android host 完全不畫 UI，所以 anchor 目前只有 Web 會生效。
