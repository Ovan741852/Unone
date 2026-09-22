# BlueStacks 原生預覽 UI／Bloom 驗證

日期：2026-09-19
範圍：YesSir／Ashen Legion 的 Android 原生包，透過 BlueStacks ADB `127.0.0.1:5556` 驗證。

## 事件與檢討

先前把「能進入 BlueStacks、能看到畫面」當成「原生預覽已完成」是不正確的驗收。這次應該分別驗證：

1. 文字是否可讀。
2. Web 與 native 的渲染能力是否一致。
3. 需求中的特效是否真的出現。
4. 截圖與 runtime capability 是否互相吻合。

原本沒有完成第 2、3 項，因此不應宣稱 Bloom 已支援。

## 已修正：CJK 文字顯示

### 根因

舊 native package 只帶 `content/fonts/kenpixel.ttf`。該字型沒有繁體中文 glyph；原生文字 rasterizer 找不到 glyph 時，畫面出現白色方塊，造成「BlueStacks 文字掉了」的錯誤表象。

### 修正

YesSir 的 `player.presentation.json` 現在指定：

```json
{
  "ui": {
    "font_source": "fonts/NotoSansCJKtc-Regular.otf",
    "font_family": "Noto Sans CJK TC"
  }
}
```

並附上官方 Noto Sans CJK TC OTF 與 OFL-1.1 授權檔。用修正版內容重新 export、pack APK，透過 ADB 安裝到 BlueStacks。

### 驗收證據

- [修正版主畫面](C:/Users/liNao/AppData/Local/Temp/bluestacks-fontfix-cjk.png)
- [修正版讀取畫面](C:/Users/liNao/AppData/Local/Temp/bluestacks-fontfix-after-load.png)
- [修正版遠征設定](C:/Users/liNao/AppData/Local/Temp/bluestacks-fontfix-new-save.png)
- [修正版地圖](C:/Users/liNao/AppData/Local/Temp/bluestacks-fontfix-expedition.png)
- [修正版戰鬥](C:/Users/liNao/AppData/Local/Temp/bluestacks-fontfix-battle.png)
- [修正版編隊／戰鬥狀態](C:/Users/liNao/AppData/Local/Temp/bluestacks-fontfix-formation.png)

上述畫面中的「森林領主」「七輪遠征・奪回森林王冠」「讀取進度」「系統設定」「離開」等中文均可讀，未再出現白色缺字方塊。

## 已修正：native Bloom 與亮度落差

這不是字型問題，且不是截圖誤差。原本 native renderer 沒有後處理，現已補上正式 WGPU pipeline：

- scene 先繪製到 full-resolution offscreen color target。
- quarter-resolution threshold、水平 blur、垂直 blur，再合成回 surface。
- `player.presentation.json` 的 `bloom: true` 同時供 Web、Windows native、Android native 使用。
- native 匯出能力清單已包含 `bloom`；動態切換仍明確標為「需重啟」，不會讓 AI 誤以為可熱切換。
- imported mesh 的 native shader 改為與 Web `MeshBasicMaterial` 同樣不加額外 directional light，並把 clear color 對齊 Web 的 `#111827`。

### 判定

「BlueStacks 畫面比 Web 黑」與「Bloom 沒出現」的根因已修正；不能只用提高 clear color 冒充 Bloom，而是使用同一份 presentation 設定與實際後處理。

Bloom 被分類為可重用的 renderer primitive（Rust/WGPU），不是 Ashen Legion 的 Luau gameplay 規則。實作包含 offscreen target、threshold、水平／垂直 blur、合成與色彩空間對齊。

### 原生驗收證據

- [Bloom 主畫面](C:/Users/liNao/AppData/Local/Temp/bluestacks-bloom-native.png)
- [Bloom 讀取畫面](C:/Users/liNao/AppData/Local/Temp/bluestacks-bloom-load.png)
- [Bloom 領主遠征](C:/Users/liNao/AppData/Local/Temp/bluestacks-bloom-new-save.png)
- [Bloom 景點列表](C:/Users/liNao/AppData/Local/Temp/bluestacks-bloom-expedition.png)
- [Bloom 誓約](C:/Users/liNao/AppData/Local/Temp/bluestacks-bloom-battle2.png)
- [Bloom 部隊配置](C:/Users/liNao/AppData/Local/Temp/bluestacks-bloom-formation.png)
- [Bloom 戰鬥](C:/Users/liNao/AppData/Local/Temp/bluestacks-bloom-combat.png)
- [最終 production APK 主畫面](C:/Users/liNao/AppData/Local/Temp/bluestacks-bloom-final-current.png)
- [BlueStacks Bloom release benchmark](C:/Users/liNao/AppData/Local/Temp/bluestacks-bloom-diagnostic-final.json)
- [BlueStacks Bloom benchmark frame](C:/Users/liNao/AppData/Local/Temp/bluestacks-bloom-diagnostic-final.png)

BlueStacks `127.0.0.1:5556` 已安裝並啟動新版 Android x86_64 APK；可由主畫面一路進入讀取、建立存檔、遠征、誓約、部隊配置與戰鬥。中文 glyph、場景亮度與 Bloom pipeline 均在同一包中驗證。

為避免把舊檔案誤當成新版證據，另外用同一份內容、同一個 Android x86_64 release runtime 建立一次有明確 frame limit 的診斷包。該包在 BlueStacks 的 OpenGL ES backend 完成 120 個量測 frame：`bloom_enabled: true`、`error: null`、平均約 60 FPS；同時輸出含繁中 UI、場景亮度與光暈的 benchmark frame。原本 `com.unone.nativeplayer/files/benchmark.json` 的 `kenpixel.ttf` 錯誤是 9/18 的舊檔案（檔案修改時間早於本次 APK），不是目前包的執行結果；生產預覽設為持續執行，因此不會自行結束寫入 benchmark。

Windows RTX 5080 Vulkan release runtime 也以同一份 content 完成 3 個 capture frame：`bloom_enabled: true`、`error: null`；[Windows Bloom frame](D:/Projects/Unone/target/ashen-native-bloom-content/windows-captures-3/frame-000000.png) 與 [Windows report](D:/Projects/Unone/target/ashen-native-bloom-content/windows-bloom-report-3.json) 可追溯。

## 目前結論

- CJK 字型：已修正，BlueStacks 實機畫面驗證通過。
- Native 預覽可啟動與操作：已驗證。
- Native Bloom：已支援；WGPU shader 單元驗證與 BlueStacks 實機流程驗證通過。
- Web/native 視覺 parity：本次已對齊 Bloom 設定、clear color、imported mesh unlit 路徑；Windows Vulkan 與 BlueStacks OpenGL ES 的 release runtime 均以 `bloom_enabled: true`、`error: null` 完成證據。這仍不等同於覆蓋所有實體 GPU，正式發版仍需收集代表性 Android/iOS GPU 的截圖與報告。
- 受擊閃爍：本次只驗證可進入戰鬥，沒有建立可重現的前後影格證據，因此不能宣稱已驗證。

下一個正確工作包是收集代表性實體 Android/iOS GPU 的相同報告與截圖；不應再修改遊戲的 Luau 受擊邏輯或用亮度常數掩蓋差異。
