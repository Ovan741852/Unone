# 資產維護盲評報告

狀態：`ready_for_review`。本報告只對本輪 asset maintenance sample 作 native-local 證據整理，不把它標成七款 finalgate passed。

## 輸入與隔離

- 唯一企劃：`C:\Temp\unone-asset-gate-20260906\task.md`
- 唯一 engine package：`C:\Temp\unone-asset-gate-20260906\engine`
- 遊戲輸出：`C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評`
- evidence：`C:\Temp\unone-asset-gate-20260906\evidence`
- 未讀取 `D:\Projects\Unone` source/docs/tests/其他 Games/review；未改 engine package、task、branch、commit 或 push。
- package verification：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Temp\unone-asset-gate-20260906\engine\scripts\verify-ai-engine-package.ps1 -PackagePath C:\Temp\unone-asset-gate-20260906\engine
```

結果：`AI engine package verified`，並觀測到 `CLI and Web host agree on the UI placement contract`。

首個操作與首次錯誤的原始命令/輸出保留在 `first-operation-and-first-error.md`。

## 七項資產證據

### 1. stable id 替換與影響範圍

初版 `asset://characters/hero` primary：762 bytes，sha256 `b3c6c5f7b33ef135a64a06e80d6d9b61d73b041cdab114e839b4f73c000075b7`。

修改前先用 `asset describe --id asset://characters/hero` 查到 manifest pointer `/assets/0`；靜態引用是 `scenes/main.scene.json` 的 `/entities/1/sprite/asset`（`hero-left`）與 `/entities/2/sprite/asset`（`hero-right`）。scope 是 `main_scene_only` 且 `dynamic_luau_assets_included=false`，所以不能聲稱找到 Luau/host/外部動態引用。

替換後內容是明顯不同的 cyan lantern SVG，936 bytes，sha256 `f66dc71a29cc83bdb7e8199081f9da69c4a02460175cdf81ccd61b1e39ee0344`；stable id、兩個 scene entity、sprite size/position/layer 均保留。

### 2. source 搬到含空白的合法相對路徑

最後 authoring source 是 `assets/characters/hero art/hero revised.svg`，舊 `assets/characters/hero.svg` 不存在；manifest entry 的 id/kind/bundle 未變，只改 `source`。新路徑 hash 仍是 `f66dc71a...ee0344`。

移動前後 `scenes/main.scene.json` hash 都是 `ecf4f5ca7f092fe0d16c9c7fc95c36ffb5f18e02b2e1615272f6086cca8f4903`；entity transform、sprite size/layer 未被不必要改寫，本 scene 沒有 rigidbody/collision 宣告。

曾嘗試以相同 id 再跑 `asset init`，完整錯誤為 `ASSET_MANIFEST_DUPLICATE_ID`；它是 append-only declaration 的預期拒絕，不是 blocker。依 package asset workflow 對搬檔的明文規則，以 apply_patch 修改遊戲自己的 manifest entry，再重新 pack，沒有改 engine。

### 3. primary/companion 讀取區分

`asset://characters/hero-rig` 宣告為 `spine`、bundle `characters`；final 檔案角色與 hash：

| role | path | size | sha256 |
|---|---|---:|---|
| primary | `assets/characters/hero-rig.json` | 125 | `df0aae745de617440b0653119462098771c33210f79e37f822aebf519bbfc95b` |
| companion | `assets/characters/hero-rig.atlas` | 82 | `84e2aac404b2f7d21393a620b98a491ee5905329ef251e77336b9682049d99c7` |
| companion | `assets/characters/hero-rig.page` | 55 | `6d51cda940eedb5a31b426cf89b9c4c6332c029ee3081fefbeeb1e614c786be0` |

既有 atlas 從初版 52 bytes / `d2cf5d91f8b441cd6106b77a6a4499cfa112945d14a797e641043ab46c5e6b98` 改為上述 82 bytes；primary 未改；另增宣告與檔案 `hero-rig.page`。不帶 `--file` 的 `asset read` 回 primary；帶完整 `--file assets/characters/hero-rig.atlas` 或 `.page` 的 read 回 companion，各自回報獨立 size/hash/bundle_generation=3。這些 bytes 明確標成 test bytes，不宣稱是真 Spine/Effekseer 格式或可播放。

### 4. 兩個未發布階段

1. 只改 hero bytes、尚未 pack：`asset describe` 回 `matches_authoring=false`、`asset_spec_matches=true`、`primary_bytes_match=false`；`asset read` 安全地回 generation 1 舊 bytes。
2. manifest source/companion 宣告更新並已 `bundle pack`、尚未 install：`bundle inspect` 回 manifest version 2/3 但 `active_generation` 仍 1/2；`asset describe/read` 回 `BUNDLE_GENERATION_MISMATCH`，不混用新 metadata 與舊 bytes。

未使用清除整份 cache、刪 .unone、退回 generation 或手改 archive。

### 5. 修訂發布與完整包

最後一次 `bundle pack`：manifest version 3、`manifest_changed=false`；`bundle install --all` 建立/保持 native-local active generation 3。

最終 `bundle inspect`：`valid=true`，六個 entries（`project`、`script`、`scene`、`asset-manifest`、`characters`、`environment`）均 source/hash/cache/available valid；兩個 content bundles 都依賴 `project` + `asset-manifest`。

最終 `asset inspect --strict`：`ok=true`、3 declared、3 static scene references，missing ids/sources/bundles 皆空、`ready_for_packaging=true`；hero-rig 是 `unreferenced_asset_ids`，只表示 main scene 沒有靜態引用，不表示可安全刪除。

最終 `verify`：types、assets、layout、tests 全部 passed；`passed=4`、`failed=0`、`not_applicable=0`；兩個 deterministic tests 均 passed。

### 6. 不完整 companion 失敗案例

以可逆 move 將已宣告的 `assets/characters/hero-rig.page` 移出遊戲目錄，沒有刪除；再跑：

```powershell
game --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json asset inspect --strict
game --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json bundle pack
game --project C:\Temp\unone-asset-gate-20260906\遊戲 資產盲評 --json bundle inspect
```

strict inspect 回 `ASSET_SOURCE_MISSING`，`missing_sources=["assets/characters/hero-rig.page"]`、`ready_for_packaging=false`；pack 回 `ASSET_SOURCE_NOT_FOUND`。失敗後 bundle inspect 仍是 manifest version 3、active generation 3、active hashes 與失敗前完全相同，證明不完整內容沒有被啟用。恢復 move 後 strict/pack/inspect/read 全部回正常。

### 7. native-local / Web 邊界

本輪只觀測 immutable package 的 native Windows CLI/local filesystem：pack、strict inspect、bundle inspect/install、describe/read、deterministic run/test，以及 textual UI layout。`asset read` 與 independent `Get-FileHash` 證明的是 verified bytes、generation、size/hash 與宣告角色；不能證明貼圖真正畫對。

沒有跑 Web runner、browser IndexedDB、WebGPU/像素截圖、Android/iOS host、Spine runtime decode/playback、CDN/OPFS 或 production hot-update。Web `127.0.0.1:8120` 後續由主代理觀測；本報告不把 native active 推論成 Web active。

## 最終獨立 hash

完整 machine-readable 表在 `validation-report.json`；核心檔案如下：

| file | bytes | sha256 |
|---|---:|---|
| `project.unone.json` | 375 | `1f66c0d09a1565f45dc862e88ba82af86d1680a4b4c0e53341b9002a6dc65151` |
| `scripts/main.luau` | 5437 | `1bc77ba25d99f6827c957c316b85aef5fed80320d2cbe4b43815c7b496f64794` |
| `scenes/main.scene.json` | 908 | `ecf4f5ca7f092fe0d16c9c7fc95c36ffb5f18e02b2e1615272f6086cca8f4903` |
| `assets/manifest.json` | 636 | `d5cd61d442ee292b92694a8de8e4f47344b1c222b3b617da0f2d3eecd7b53049` |
| `assets/characters/hero art/hero revised.svg` | 936 | `f66dc71a29cc83bdb7e8199081f9da69c4a02460175cdf81ccd61b1e39ee0344` |
| `assets/scenes/courtyard.svg` | 1251 | `b7d7fbb1cf46710c8c1b0bcf9e8299a4df925f58b0f81ef9b2c42e595610b4b9` |
| `assets/characters/hero-rig.json` | 125 | `df0aae745de617440b0653119462098771c33210f79e37f822aebf519bbfc95b` |
| `assets/characters/hero-rig.atlas` | 82 | `84e2aac404b2f7d21393a620b98a491ee5905329ef251e77336b9682049d99c7` |
| `assets/characters/hero-rig.page` | 55 | `6d51cda940eedb5a31b426cf89b9c4c6332c029ee3081fefbeeb1e614c786be0` |
| `bundles/manifest.json` | 1628 | `ab816dcde02d2e52ddcbd8fe690bf5f059a17b5aab9d469c8749c7a9506327db` |
| `bundles/characters.bundle` | 1847 | `575d59750e087ce4e4e8bbbb9a2983e1c8bcadcf82b6f47e906d5e6797e412b7` |
| `bundles/environment.bundle` | 1437 | `f5fd1a37b84dc7c357093c0bc993ba047286fad942c9b48b06cead0c56e590ed` |

## 只靠 package 是否能取得下一步

可以。`asset describe` 在各階段輸出完整 authoring/active/publication scope 與 ordered `required_next_actions`，包含可直接執行的 `game` logical executable + argv；有效流程不需要 engine source。唯一需注意的是 `asset init` 對已有 id 是 append-only，搬檔必須依同一份 package 文件直接改 authoring manifest entry，不能用 init 猜 update。

## 教學噪音與保留輸出

為滿足 onboarding 的 check/verify/layout smoke，遊戲保留了最小 UI tree、save round-trip、input replay test 與 textual UI preview；它們不是本輪 task.md 的必要資產驗收，主代理可將其視為教學/驗證噪音，不應延伸成玩法完成度。已製作輸出均保留，沒有刪除整份 cache 或其他資料。

## 可選素材來源

本輪未使用 itch.io；兩張 SVG 是自製，沒有第三方授權或署名依賴。因此沒有素材來源 URL、作者或取得日期可登錄。
