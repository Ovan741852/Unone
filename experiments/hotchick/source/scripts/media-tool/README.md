# 海王素材工坊

啟動 `.\Start-MediaTool.ps1`，開啟 <http://127.0.0.1:8242/>。工具在本機處理影片，來源原檔保留；產物預設放在 `assets/generated/<角色代號>/`。

## 使用

1. 拖入影片、選擇檔案，或貼上 Windows 本機影片路徑。
2. 預覽影片並設定片段起點、終點。啟用裁切後，可拖動選框、調整四角，或直接輸入來源像素座標；「中央方形」可快速製作盤面取景。
3. 選擇角色、風格與輸出用途，加入佇列；可混合多支來源及多種輸出。
4. 檢查配方，再按「產生素材」。完成後可預覽、下載產物，或複製輸出資料夾路徑。
5. 匯出 JSON 配方，下次匯入後即可重複生成。「藝瑟範例」可載入這次六支來源、十九項媒體輸出的設定。

預設不覆寫已存在的產物；確定要重新生成時勾選「覆寫同名產物」。來源原檔不作為輸出目標。

## 輸出預設

| 用途 | 產物 |
| --- | --- |
| 盤面圖集 | WebP 圖集、縮圖；小型可同時產生 480×480 回顧 MP4 |
| 中型演出 | 270×480 演出 MP4、720×1280 回顧 MP4、縮圖 |
| 滿版演出 | 1920×1080 演出 MP4、縮圖 |

圖集預設 128px／12fps，可調整。影片保留所選片段與可用音訊；「完整保留」按比例補邊，「填滿畫面」會裁去超出輸出比例的邊緣。透明補邊不會去除影片原有背景。

輸出包含來源 SHA-256 記錄、原檔副本（可選）、配方快照、`runtime-manifest.json`；有圖集時另產生 `field-sprites.json`。每張圖集記錄自己的格數、幀率、排列及循環長度，可處理不同片長。產物確認後即可換入遊戲素材；角色的底注門檻與風格抽選使用遊戲中的設定。

## 命令列

使用同一套生成器與 JSON 配方，不需要替每個角色重寫腳本：

```powershell
& 'C:\Program Files\Python312\python.exe' scripts/media-tool/media_tool.py validate `
  --recipe assets/media/yeseul/recipe.json `
  --output-dir assets/generated/yeseul

& 'C:\Program Files\Python312\python.exe' scripts/media-tool/media_tool.py build `
  --recipe assets/media/yeseul/recipe.json `
  --output-dir assets/generated/yeseul `
  --json
```

重生既有產物時加 `--overwrite`。本機依賴為 Python、Pillow 與 `C:\ffmpeg\ffmpeg.exe`／`ffprobe.exe`；可用 `HOTCHICK_FFMPEG`／`HOTCHICK_FFPROBE` 指定其他安裝路徑。

## 驗證

- `scripts/qa-media-tool.py`：合成片實測空間裁切、時間片段、幀率、contain／cover、圖集透明空格、縮圖、上傳、預覽 Range、非同步工作與下載。
- 錯誤配方、路徑越界、來源覆寫、跨來源請求與明確覆寫流程有獨立檢查。
- 藝瑟配方已透過通用生成器重生至 `assets/generated/yeseul-tool-proof`，另外檢查六個來源、十九個媒體的 SHA-256、八支影片解碼及圖集 metadata。

測試報告放在 `artifacts/media-tool-qa/`。
