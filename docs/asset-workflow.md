# Asset workflow contract

這是目前唯一有效的資產操作與引擎邊界契約。CLI、MCP、native local
bundle reader 與文件都以同一份 engine core 結果為準；舊的資產 reference
與 host resolve decision 已移除，Git 歷史仍保留它們的過往紀錄。

## 先分清三種狀態

資產工作流有三個不同的權威來源：

1. **Authoring** 是遊戲專案內的 `project.unone.json`、asset manifest、
   primary source 與 manifest 宣告的 companion files。manifest entry 的
   `id`、`source`、`kind`、`bundle`、`files` 是作者契約；scene 只用同一個
   stable id 控制放置與表現。
2. **Packaged** 是 `bundle pack` 從作者檔案產生的 bundle manifest、hash
   與 archive。不能手改 archive 或 cache 代替修改 source；pack 也不會
   自動啟用新的 generation。
3. **Active** 是 native local 明確安裝後的一份 generation。`asset read`
   只讀符合目前 bundle manifest 與 active hash 的 verified bytes，不 fallback
   到作者 source。

`asset describe` 只回答 selected asset 在 `native_local` 是否與 authoring 相符。
freshness 為 true 不代表所有 bundle、整個遊戲、Web IndexedDB、Android 或
其他 host 都已同步，也不代表 native/Web renderer 已完成。

## 權威層級與 stable id 編輯規則

權威由上游到下游固定排列：

1. **Authoring source** 是唯一可編輯的內容權威：project config 指向的
   manifest、manifest entry、primary 與 companions，以及作者明確寫入的 scene。
2. **Packaged bundle** 是由 authoring 產生的可驗證輸出：bundle manifest、
   archive bytes、size/hash 與 dependency metadata 都應重新 pack 取得，不能手改。
3. **Active generation** 是安裝後的本地觀測結果：它只能由 bundle install 啟用，
   不可用 cache、archive 或 active metadata 反向當成 authoring。

穩定 id 是 scene 與 host 尋找資產的連接點。替換同一 id 的 source 或 companion
bytes 時保留 id，通常不需要改 scene 的引用；修改內容後重新 pack、strict inspect
與安裝即可。若搬移 source 或 companion，才修改 manifest 的 `source`／`files`
路徑，仍保留 stable id。scene 的 size、pivot、碰撞體與放置是獨立的 scene 編輯，
引擎不會因 source 替換自動改寫它們。

新增資產要先建立實際內容，再以 `asset init` 加入 declaration；init 不會產生、
下載或猜測美術。刪除或真正 rename id 不由本輪工具自動改寫引用：靜態 main scene
沒有引用不代表 Luau、host 或外部內容沒有動態使用，不能把 unreferenced 當安全刪除。
同一檔案可被多個 manifest entry 共用；改它會影響所有宣告該檔案的 ids，查詢只
報告 manifest 可觀測到的共用關係。

## 宣告格式

`project.unone.json` 指向一份 asset manifest：

```json
{
  "version": 1,
  "assets": [
    {
      "id": "asset://characters/hero",
      "source": "assets/characters/hero.svg",
      "kind": "texture2d",
      "bundle": "content",
      "files": []
    }
  ]
}
```

目前 core 支援的 `kind` 是 `texture2d`、`mesh3d`、`spine`、`effekseer`。
`files` 是不可缺少的 project-relative companion sources，例如 Spine atlas
與 texture pages；引擎不猜格式、不解碼，也不替作者建立美術內容。

## 工具入口

CLI 與 MCP 都是 Developer Protocol 的薄 client，實際檢查與選擇規則由
engine core 共用：

```powershell
game --project <game-root> --json asset inspect
game --project <game-root> --json asset inspect --strict
game --project <game-root> --json asset describe --id <asset-id>
game --project <game-root> --json asset read --id <asset-id>
game --project <game-root> --json asset read --id <asset-id> --file <declared-companion>
game --project <game-root> --json bundle pack
game --project <game-root> --json bundle install <bundle-id>
game --project <game-root> --json bundle install --all
```

MCP 對應工具是 `unone_asset_inspect`、`unone_asset_describe`、
`unone_asset_read`、`unone_asset_init`、`unone_bundle_pack`、
`unone_bundle_inspect` 與 `unone_bundle_install`。`tools/list` 應回報 23 個
工具；`unone_asset_describe` 是 read-only，`unone_asset_read` 則是
`readOnlyHint=false`，因為傳入 output 時可能寫檔。

### `asset describe`

`game asset describe --id <id>` 對單一已宣告 id 做聚焦查詢，不重做完整
`asset inspect` gate，也不默默讀取所有資產 bytes。它會把 authoring 的 manifest
定位與宣告檔案、主場景靜態引用、native-local active observation、selected-asset
publication freshness 與 ordered next actions 放在同一份 `EngineResult`；`ok`
只表示查詢完成，freshness 為 false 或 unknown 時不得自行改成 true。

目前 `AssetDescribeReport` 的 serialized shape 包含 `project_root`、`asset`、
`authoring`、`references`、`reference_scope`、`active`、`publication` 與
`required_next_actions`。`authoring` 的 manifest 欄位是 `manifest_path` 與
`manifest_json_pointer`；files 逐一指出 primary／companion 的 role、exists、
可讀時的 size/hash、`shared_with_asset_ids`，以及必要時的 structured diagnostic。
引用欄位保留主場景的 path、`json_pointer`、id、entity、component 與實際 array
index，涵蓋 `sprite`、`mesh3d`、`animation`；它不是任意字串搜尋，也不是 selected
asset 的全體影響分析。`reference_scope` 明確標示 `main_scene_only`，以及 Luau
動態建立／選擇的 id 未被檢查；不把 unreferenced 當成可安全刪除。

`active` 的 scope 是 `native_local`，並回報 generation、active manifest entry、
每個 primary／companion 的 verified 狀態與 size/hash、structured diagnostics、
以及 observation token 前後是否一致。`publication` 的 scope 是
`selected_asset_native_local`；`asset_spec_matches`、`primary_bytes_match`、
`companion_bytes_match`、`bytes_match` 與 `matches_authoring` 必須如實保留
`true`／`false`／`null`，不能把 read 成功或 bundle hash 有值冒充 freshness。

`active.asset_manifest_json_pointer` 定位的是已驗證的保留 bundle
`asset-manifest` 內的 entry，不是作者目前的 manifest 檔案。作者可能搬移
manifest 卻還没打包；因此 active 不提供由 authoring path 推測出來的檔案路徑。

成功查詢的最小 shape（省略 optional diagnostics）如下；實際值以 core result 為準：

`AssetSpec.files` 為空時會依 core 的 serde 設定省略；authoring/active file 狀態仍由各自的 `files` 陣列表達。

```json
{
  "project_root": "<absolute-project-root>",
  "asset": {
    "id": "asset://characters/hero",
    "source": "assets/characters/hero.svg",
    "kind": "texture2d",
    "bundle": "content"
  },
  "authoring": {
    "manifest_path": "assets/manifest.json",
    "manifest_json_pointer": "/assets/0",
    "files": [
      {
        "path": "assets/characters/hero.svg",
        "role": "primary",
        "exists": true,
        "size_bytes": 123,
        "sha256": "<sha256>",
        "shared_with_asset_ids": []
      }
    ],
    "editing_rules": ["<engine-provided editing rules>"]
  },
  "references": [
    {
      "path": "scenes/main.scene.json",
      "json_pointer": "/entities/0/sprite/asset",
      "id": "asset://characters/hero",
      "entity": "player",
      "component": "sprite"
    }
  ],
  "reference_scope": {
    "scope": "main_scene_only",
    "roots_inspected": ["scenes/main.scene.json"],
    "components_inspected": ["sprite", "mesh3d", "animation"],
    "dynamic_luau_assets_included": false,
    "limitations": ["<engine-provided limitations>"]
  },
  "active": {
    "scope": "native_local",
    "generation": 3,
    "asset_manifest_json_pointer": "/assets/0",
    "asset": {
      "id": "asset://characters/hero",
      "source": "assets/characters/hero.svg",
      "kind": "texture2d",
      "bundle": "content"
    },
    "files": [
      {
        "path": "assets/characters/hero.svg",
        "role": "primary",
        "verified": true,
        "size_bytes": 123,
        "sha256": "<sha256>"
      }
    ],
    "diagnostics": [],
    "observation_token_before": "<token>",
    "observation_token_after": "<token>",
    "observation_consistent": true
  },
  "publication": {
    "scope": "selected_asset_native_local",
    "matches_authoring": true,
    "asset_spec_matches": true,
    "primary_bytes_match": true,
    "companion_bytes_match": true,
    "bytes_match": true,
    "reasons": []
  },
  "required_next_actions": [
    {
      "action": "asset_read_primary",
      "kind": "command",
      "reason": "<engine-provided reason>",
      "executable": "game",
      "argv": ["--project", "<absolute-project-root>", "asset", "read", "--id", "asset://characters/hero", "--json"],
      "ready": true,
      "status": "ready",
      "prerequisites": []
    }
  ]
}
```

缺 source、companion、active record、cache 或 archive bytes 時，結果應保留可用
的定位與 structured diagnostic，不把錯誤壓成 missing 或 false。最新正式 active
generation 無法讀取時回報 `BUNDLE_ACTIVE_GENERATION_UNREADABLE`，不靜默退回較舊
generation。查詢期間 manifest 或 generation 改變時不得回報 freshness true，應
重新 describe。

後續命令以 `AssetWorkflowAction` 的 `action`、`kind`、`reason`、`executable`、
`argv`、`ready`、`status`、`prerequisites` 表示。`executable: "game"` 是邏輯
CLI 名稱，不要求 blind AI 猜 PATH 或安裝 alias；使用 immutable package 時，
固定把它解析成該 package 的 `bin/game.exe`。`argv` 每項保留 core 產生的原值，
交給 subprocess argument list 執行，不拼接 shell 字串；因此特殊字元、空白與
asset id/path 不會被重新解析。primary 的 read argv 不帶 `--file`；companion 的
read argv 帶完整宣告的 `--file`。非機械的美術編輯步驟會標為 AI／作者工作，不
偽裝成命令；describe 本身不執行 pack、inspect、install 或 read。

## 新資產 bootstrap 順序

新資產不從「只 install content」開始；先建立作者內容，再宣告、打包、驗證、
啟用並查詢：

1. AI 或作者在 project root 建立實際 primary bytes，以及所有 companion bytes。
2. 用 `game asset init --id <id> --source <project-relative-source>` 宣告
    manifest entry；`asset init` 只寫 manifest/project config，不建立或猜測
    圖片、模型、Spine 或 Effekseer 檔案。初始化後先看回傳的 `changed_files`；
    成功新增 asset 時才會提供 `describe_argv`；沒有 `new_asset` 時該 optional
    欄位會省略，不會虛構 `<asset-id>`。若部分寫入後失敗，failure effects 會
    如實列出已發生的變更。
3. 用 `game bundle pack` 從 authoring files 產生／更新 bundle manifest、hash
   與 archive。
4. 用 `game asset inspect --strict` 驗證主場景靜態引用、manifest、source、
   companion、bundle 與支援的 kind/version。
5. 用 `game bundle install --all` 一次驗證並啟用完整 generation；若只需一個
   bundle，才使用 `game bundle install <id>`。所有選中 roots 驗證完成後只寫
   一份 active generation。
6. 再用 `game asset describe --id <id>` 確認 authoring、active 與
   `matches_authoring`，最後用 `game asset read --id <id>` 取得 verified bytes。

asset read 的 `--output` 是使用者明確授權的匯出路徑；它不是 source resolver，
也不會讓 describe 的 read argv 帶 output。

## bundle install 選擇契約

CLI 的 `id` 是 optional positional argument，`all` 是 bool flag；core 只接受
以下兩種選擇：

| 參數 | 結果 |
|---|---|
| `bundle install <id>` | 安裝該 id 及 dependency closure |
| `bundle install --all` | 安裝 manifest 的所有 roots 及 dependency closure |
| `bundle install` | `BUNDLE_SELECTION_INVALID`；不建立 generation |
| `bundle install <id> --all` | `BUNDLE_SELECTION_INVALID`；不建立 generation |
| `bundle install ""` | `BUNDLE_SELECTION_INVALID`；空 id 不算選擇 |

每次啟用的集合只由這次選擇決定，不會自動累加前一代的其他包。
例如先 install A 再 install 無依賴的 B，第二代只含 B；需要同時啟用所有包
時使用 `--all`，不要把多次單包 install 當作累加操作。

MCP `unone_bundle_install` 的 schema 以 `oneOf` 表示恰好一種：id 分支允許
`all` 缺省或 `false`，all 分支要求 `all:true` 且不得有 id；handler 仍會對
`id`/`all` 做嚴格 string/boolean parsing，再傳入同一個
`install_selected(id.as_deref(), all)`。因此 `{"id":"content","all":false}`
與 id-only 完全同義；`{}`、`{"all":false}`、`{"id":"content","all":true}`
會得到相同 core semantic selection error。錯誤不得切換 active generation。

所有 manifest roots 共用同一個 installed set 與 dependency traversal；任一
fetch、hash、dependency 或 cycle failure 都保持既有 active metadata。空或重複
bundle id、無效 hash/size、缺失或循環 dependency 也在 activation 前拒絕。

## `asset inspect` 與邊界

`asset inspect` 是全體 manifest／scene 的 authoring advisory；需要 handoff、CI
或 release gate 時用 `--strict`。它檢查主場景 `sprite`、`mesh3d`、`animation`
的靜態引用，不檢查 Luau 動態建立或選擇的 id。`unreferenced_asset_ids` 不等於
可安全刪除：動態字串、host 或外部內容仍可能使用它。

引擎只負責宣告驗證、archive integrity、native local verified read 與
generation activation；不負責影像／模型解碼、GPU resource lifetime、下載、
重試、cache quota、CDN、runtime asset lease 或遊戲 catalog。Web IndexedDB、
native `.unone` 與其他 host storage 是不同的 active scope；native CLI 啟用
不代表 Web 已啟用。`asset read` 通過也不等於 native 貼圖渲染或 Web/mobile
正式 host gate 通過。

安全路徑規則同樣套用在 manifest、scene、primary、companions、bundle manifest
與 native local bundle fetch：先做 portable lexical 檢查，再檢查現存目標與
祖先的 canonical containment。project 外 absolute path、`..`、反斜線、越界
symlink、重複 asset id、未知 kind/version 都 fail closed。

## 錯誤恢復與不變條件

依錯誤所在層級恢復，不用清 cache 或 fallback source 來掩蓋問題：

- authoring 缺 manifest、source 或 companion：建立／修正作者檔案與 declaration，
  再跑 pack。查詢可以提供定位，但不替作者生成 bytes。
- pack 或 `asset inspect --strict` 失敗：先修 manifest、path、kind/version、
  靜態 reference 或實際檔案，再重新 pack；不要安裝未通過的內容。
- 最新正式 active record 損壞或無法解析時，`install`、`describe` 與 `read` 都必須
  fail closed 並回報 `BUNDLE_ACTIVE_GENERATION_UNREADABLE`。這是 host/operator 的
  manual prerequisite：依診斷檢查並修復 record，或從可信備份復原；沒有可信備份
  就回報 blocker。不要清 cache、刪除整份 `.unone`、退回較舊 generation，或篡造
  active generation 來假裝恢復；修 source、pack 或 strict 都不能修好壞掉的 record。
- cache 或 archive bytes 損壞、或 active 尚未包含最新 authoring／bundle manifest：
  依 structured diagnostic 修正 authoring source 後走
  `pack → strict → install --all → describe → read`；這條路徑不跨越 active record
  損壞的 manual prerequisite，也不從不同 generation 拼湊結果。
- `bundle install` 的 fetch、hash、size、dependency、cycle 或 activation 失敗：
  既有 active generation 與 metadata 保持不變，已驗證的 cache 可以留下但不代表
  它已 active。這只是本次 activation 的保護，不是整個發布流程的 rollback；若
  authoring bundle manifest 已更新，舊 active 可能已不符合新 manifest 而無法 read，
  仍須依上一步重新發布。
- `asset read --output` 是使用者明確授權的匯出寫入，與 authoring source 的
  project containment 分開；describe 建議的 read 命令不附 output。

每次查詢的 freshness 只涵蓋 selected asset 的 native-local observation。generation
或 manifest 在觀測期間變動時，不能回報 fresh；重新執行 describe/read 取得新的
一致觀測。Web 的 IndexedDB、native `.unone`、mobile 或其他 host 各自安裝與驗證，
不能用 CLI 結果代替跨 host 證據。
