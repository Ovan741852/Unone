# Native Sprite 效能優化與跨平台驗證

日期：2026-09-19。範圍：`unone-native-player` 的通用 Sprite 提交路徑，非遊戲規則；Luau 行為、相機契約、貼圖與 shader 未因這次效能優化改動。

## 結論

一萬 Sprite 原本每幀建立一萬個 GPU buffer、分別上傳和繪製。改為可重用的共用 instance buffer，只合併**繪製順序中相鄰且同貼圖**的物件；沒有全域依貼圖重排。靜態資料不重複上傳，移動資料每幀一次上傳。資料按原有 `(layer, entity ID)` 排序，保留透明混合結果。

Windows 前後共 30 次真實 native GPU 執行；15 對測試的資產包、最終狀態 digest、PNG SHA-256 全相同。BlueStacks 另實跑兩個 Android NativeActivity 案例，狀態與 Windows 相同，但截圖發現跨平台色彩差異，**不宣稱全平台視覺一致**。

## Windows 前後量測

RTX 5080、NVIDIA 610.47、Vulkan、1280×720。兩版都是 release、沒有 native-codegen。每案例各跑三次，每次暖機 30 幀、取樣 180 幀；下表為三次平均值的中位數，FPS 為三次 FPS 的中位數。

| 場景 | Prepare：前 → 後 | Encode/submit：前 → 後 | FPS：前 → 後 |
| --- | --- | --- | --- |
| 1,000 靜態 Sprite | 1.445 → 0.039 ms | 0.775 → 0.133 ms | 179.7 → 179.8 |
| 1,000 移動 Sprite | 1.405 → 0.033 ms | 0.735 → 0.127 ms | 180.2 → 180.2 |
| 10,000 靜態 Sprite | 20.815 → 0.320 ms | 10.344 → 0.131 ms | 31.6 → 179.9 |
| 10,000 移動 Sprite | 21.436 → 0.437 ms | 10.848 → 0.183 ms | 24.0 → 109.6 |
| 12 個透明重疊 Sprite | 0.039 → 0.004 ms | 0.135 → 0.134 ms | 180.2 → 180.0 |

- 一萬靜態物件 prepare 降低 98.46%；移動降低 97.96%。
- 一萬同貼圖物件從一萬次 draw 改成一次；透明重疊案例仍保留三次 draw，避免破壞順序。
- 暖機後靜態上傳 0 bytes；一萬移動物件每幀上傳 240,000 bytes（一次 instance buffer 寫入）。
- 修正截圖重繪造成的 2D draw/instance 計數重複累加。舊報告的一萬物件會顯示兩萬，不能把這個誤報當作原本實際的 draw 數。
- 新增 `renderer_cpu_phases.sprite_prepare`、`sprite_upload`。它們在 `prepare` 內，不可重複加總；upload 是 CPU 更新時間，不是 GPU 執行時間。
- 切回 2D 時清除舊的 LOD prepare 時間，避免沿用前一個 3D 場景的數值。

## Android 模擬器

BlueStacks Pie64，x86_64 Android native release，1600×900，OpenGL ES backend。驅動回報 Adreno 650 為**模擬器資訊**，不是實體手機證据。

| 案例 | FPS（單次） | submitted / draw | 結果 |
| --- | --- | --- | --- |
| 10,000 移動 Sprite | 59.64 | 10,000 / 1 | 210 幀完成、無錯誤；包雜湊與狀態 digest 同 Windows |
| 12 個透明重疊 Sprite | 59.36 | 12 / 3 | 210 幀完成、無錯誤；包雜湊與狀態 digest 同 Windows |

獨立測試 App：`com.unone.nativeplayer.spriteperf`，未覆蓋 Koncrate 或既有遊戲。測試腳本每次只清除此測試 App 的兩個舊報告檔案，避免讀到上次結果。截圖是該 Android native renderer 的 GPU readback，已實際開圖檢視，不是 Windows 畫面代替 Android。

### 發現但尚未解決：跨 backend 色彩差異

相同透明疊圖的幾何與順序一致，但 Android 圖比 Windows 暗。這次沒有更動 shader、貼圖色彩格式、clear color 或 surface 選擇邏輯，不能把批次優化通過當成色彩一致性通過。

- Windows：[透明疊圖截圖](native-sprite-perf-2026-09-19/windows-layering.png)
- Android：[透明疊圖截圖](native-sprite-perf-2026-09-19/android-layering.png)
- 疑點：surface 優先選 sRGB、否則直接採第一個格式；相同 linear 輸出可能沒有在非 sRGB surface 做相同的編碼。尚未做獨立色彩探針確認根因。
- 後續驗收應記錄實際 surface format，測 clear color、半透明貼圖、UI 與 Bloom 開／關；不能只對圖片加亮來補償。

## 測試與限制

- Native lib：15 passed、0 failed、1 ignored。略過的是既有需 GPU／字型環境的 UI 測試，不是 Sprite 測試。
- 新增 painter order、字串 ID 次序、A–B–A 貼圖、隱藏物件、清空、重新成長的回歸測試。
- 真實 GPU 的 static/moving/layering 案例補足 buffer 上傳與 draw 行為驗證。
- Windows PNG 相等只涵蓋這 15 對最終畫面，不能推論任意場景都相等。
- 靜態測試凍結 simulation；移動測試每次呈現跑一次正式 Luau update，不是固定每秒 60 tick 的戰鬥。
- FPS 包含 present 等待，Windows 約受 180 Hz、BlueStacks 約受 60 Hz 限制；Android 沒有跑改前版，不能宣稱 Android 改善百分比。
- GPU 計時不可用，不以 CPU 時間冒充 GPU 時間；未測實體 Android、iOS 或 Web。
- 下一個 CPU 瓶頸在移動場景的 tick 路徑：代表性 Windows run 的 tick 約 8.12 ms，而 render submit 約 0.73 ms。應先細分 Luau setter、runtime snapshot 等成本再調整，不能直接歸因於 VM 或改寫遊戲邏輯。
- **不是 YesSir 萬人戰鬥證據，也不是穩定 60 FPS 的全平台承諾。**

## 可重現入口與證據

測試基底 HEAD：`950d35f1474432221a4ba18a3588ba351ce6bf59`。工作樹已有未提交的相機／native 功能；改前執行檔取自此次優化前的工作樹，**不是乾淨 HEAD build**。改前／改後 binary SHA、package SHA、畫面 SHA 都保存在報告，不以 commit 相同推論 binary 相同。

- [Windows 機器可讀比較](native-sprite-perf-2026-09-19/windows-comparison.json)
- [Android 執行摘要](native-sprite-perf-2026-09-19/android-summary.json)
- 本機原始報告、PNG、log、改前 exe：`artifacts/camera-perf-2026-09-19/`（ignored；沒有提交大型 binary）。

以下 out 目錄必須尚未存在，避免覆寫證據：

```powershell
cargo build --release --manifest-path crates/unone-native-player/Cargo.toml --bin unone-native-player
node scripts/benchmark-native-sprites.mjs --player <baseline.exe> --out <before-dir>
node scripts/benchmark-native-sprites.mjs --player crates/unone-native-player/target/release/unone-native-player.exe --out <after-dir>
node scripts/compare-native-sprites.mjs --before <before-dir>/summary.json --after <after-dir>/summary.json --out <comparison.json>
```

Android 使用相同 `<after-dir>` 場景。先依 native Android 工具鏈編譯 x86_64 lib，設好 `ANDROID_HOME` 與 `JAVA_HOME`、連上 ADB，再執行：

```powershell
node scripts/smoke-native-sprites-android.mjs --source <after-dir> --runtime <libunone_native_player.so> --cpp <NDK-libc++_shared.so> --out <new-android-dir> --serial 127.0.0.1:5555
```

比較器遇到不同 package、狀態、PNG、重複／缺少 run、錯誤 draw／upload／instance 數會直接失敗，不產生成功報告。
