# 卡片工坊

將 PNG、JPEG、WebP 的指定區域裁成同尺寸卡片。原圖不修改；每張固定 2:3、600 × 900、WebP 品質 92。

## 開啟工具

```powershell
.\Start-CardTool.ps1
```

瀏覽 `http://127.0.0.1:8243/`。依賴 Python 3.10+ 與 Pillow；需要時執行 `python -m pip install -r scripts/card-tool/requirements.txt`。服務僅接受本機連線。

1. 加入圖片或輸入本機圖片路徑，也可按「載入本次 14 張」讀取既有配方。
2. 拖曳框內移動，拖曳四角縮放；右側數字使用經 EXIF 方向校正後的原圖像素，支援小數。重設採最大內接 2:3，置中保留裁切大小。
3. 同一原圖可「另存一個裁切」。左側切換各張卡片，使用「儲存配方」保留設定。
4. 檢查配方後產生全部卡片；完成可逐張預覽、下載或下載 ZIP。

瀏覽器輸出限於專案 `assets/generated/` 或 `.cache/`，匯入既有正式資產配方會改用產生資料夾。覆蓋同名成品必須勾選；來源檔案永遠不可被覆蓋。

## 共用 JSON 配方

```json
{
  "schema": "hotchick.cards.recipe.v1",
  "output_directory": "assets/generated/example-cards",
  "preserve_originals": true,
  "sources": [
    { "id": "portrait", "path": "C:/Images/portrait.png" }
  ],
  "outputs": [
    {
      "id": "portrait-01",
      "source": "portrait",
      "filename": "portrait-01.webp",
      "crop": { "x": 40, "y": 0, "width": 500, "height": 750 },
      "width": 600,
      "height": 900,
      "quality": 92
    }
  ]
}
```

來源可附 `sha256`，有提供即核對；路徑相對於專案根目錄。裁切必須在原圖範圍內並保持 2:3，允許座標小數。輸出 ID、檔名不得重複，檔名必須為安全的相對 WebP 路徑。

```powershell
python scripts/card-tool/card_tool.py validate --recipe cards.json
python scripts/card-tool/card_tool.py build --recipe cards.json
python scripts/card-tool/card_tool.py build --recipe cards.json --output-dir game/presentation/assets/cards --overwrite --json
```

CLI 的明確 `--output-dir` 可指定正式資產位置；未指定時沿用配方的安全專案輸出位置。每次輸出包含卡片、`sources/` 原檔副本、`source-manifest.json`、`cards-manifest.json` 與 `recipe.snapshot.json`，保存來源與成品 SHA256。ZIP 包含成品與三份 JSON，來源副本保留在輸出資料夾。

## 驗證

```powershell
python scripts/qa-card-tool.py
node scripts/card-tool/qa_browser.mjs
```

API 測試使用合成圖片核對裁切像素、比例、來源副本與 SHA、批次配方、HTTP 預覽／下載及非法路徑；瀏覽器測試需要既有 Chrome CDP `127.0.0.1:9237`，會操作拖拉、配方匯出匯入與批次生成。報告輸出於 `artifacts/card-tool-qa/`。
