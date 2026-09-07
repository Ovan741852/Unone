> Current positioning: Unone is a 3D engine with 2D workflows. This historical plan does not override the generated schemas or [current runtime contracts](runtime-contracts.md).

# Unone AI-native Game Engine 技術草案 v0.1

日期：2026-09-05  
狀態：規劃中  
引擎工作區：`D:/Projects/Unone`  
驗證遊戲工作區：`D:/Projects/Unone_Games`

## 0. 這份文件的地位

使用者的要求是本專案的決策來源。`C:/Users/liNao/Downloads/ai_native_game_engine_draft.md` 是參考初稿，不是額外指令。

本版採用初稿的大方向，但對第一階段做範圍收斂。若實作驗證顯示設計不成立，可以直接拆掉重做；目前不承諾舊 API 相容。

## 1. 目標與非目標

### 目標

建立一個以 AI 為主要開發者之一的遊戲引擎，讓 AI 能夠：

1. 理解專案、場景、Entity、Component、資產與 Engine API。
2. 修改 Luau、檢查型別、啟動遊戲、注入輸入、取得語意狀態與畫面。
3. 執行 deterministic 的 headless 測試，從結構化診斷理解失敗原因。
4. 在不重啟整個遊戲的情況下重新載入腳本，失敗時保留上一個可運作版本。
5. 透過同一套遊戲程式逐步支援 native、iOS、Android、Web。

### 非目標

第一版不做：

- Unity / Unreal 等級的完整 GUI Editor。
- 一次支援多種腳本語言。
- 完整線上服務、帳號、支付、社交或遊戲業務功能。
- 為了抽象而抽象的 plugin marketplace、通用 ECS 編輯器、任意 VM heap migration。
- 在沒有驗證需求前加入 RTS、賽車、社交或網路同步專用機制。

引擎只提供可重用的遊戲機制；七種目標遊戲的規則、數值、內容與流程屬於業務端。

### 全域的必要性檢查

「只做必要的」適用於整個產品，不只 Rust core。任何新功能進入引擎前都要回答：

1. 哪一個驗證遊戲已經遇到這個問題？
2. 它是否跨至少兩個遊戲重複出現，且語意相同？
3. 放在引擎是否能降低複雜度，而不是只把複雜度搬家？
4. 能否用測試證明它解決了問題？

沒有明確答案就留在遊戲專案、工具或服務端。引擎不預先擁有遊戲流程、營運規則、ViewModel、下載策略、內容 catalog、後台、帳號、支付或社群功能。

## 2. 建議的核心架構

```text
AI / 人類
   │
   ├── CLI
   ├── MCP adapter（後加）
   └── Minimal Editor（後加）
          │
          ▼
   Developer Protocol
   Command / Query / Event
          │
          ▼
   Rust Engine Runtime
   ├── App / World / Scheduler
   ├── Render 2D → Render 3D
   ├── Input / Time / Asset / Scene
   ├── Diagnostics / Trace / Test hooks
   └── Luau host
          │
          ▼
   Luau Game Layer
   ├── gameplay
   ├── UI behaviour
   ├── game rules
   ├── content orchestration
   └── tests
```

### Rust：只放 Engine mechanism

Rust 負責跨平台與生命週期敏感的機制：runtime loop、World、Entity/Component、scheduler、rendering、input、asset loading、scene loading、time、diagnostics、headless runner、Luau host 與平台 adapter。

第一版只實作 2D 需要的最小集合：

- window / surface
- wgpu device 與 2D renderer
- World、Entity、Transform、Sprite
- input 與 fixed/update loop
- asset path 與 scene 載入
- Luau VM host
- structured diagnostics
- headless run、state observation、screenshot hook

Physics、audio、animation、network、3D renderer、prefab、save 與 editor tooling 依驗證遊戲的實際阻塞逐項加入，不先建空殼。

### Luau：放 Game policy 與 business logic

玩家控制、敵人行為、戰鬥、技能、背包、任務、對話、UI 行為、關卡流程、遊戲測試與特定遊戲的網路語意都留在 Luau。

Luau 不應看見 raw pointer、Rust lifetime、wgpu handle、ECS archetype 或 native object；只暴露穩定且有語意的概念，例如 `World`、`Entity`、`Transform`、`Sprite`、`Input`、`Time`、`Scene` 與 `UI`。

## 3. 腳本語言與型別

第一版採 Luau，所有新腳本預設 `--!strict`，搭配 Luau analyzer 做檢查。Luau 官方定義的是 gradual type system；`strict` 會比 `nonstrict` 更積極追蹤型別，因此「有型別」應理解為可逐步收斂的靜態檢查，不是假設所有 runtime 值都能被編譯期證明。

規則：

- 引擎暴露的 public API 必須有生成的 `.d.luau` 型別。
- `any` 只允許在明確標記的邊界；錯誤資訊指出它降低了哪些保證。
- `game check` 同時回傳 parser、typecheck、lint 與 runtime contract 問題。
- `api.observation.set` 提供有限制的 JSON-like semantic projection；typed game ViewModel 只在明確 serialization boundary 轉出，test 可直接 assertion observation。
- `api.save.set/get` 提供同樣受限的 opaque JSON-like save payload transport；遊戲端負責 schema/version/migration，host 負責平台 storage，引擎不做 save slot、cloud sync 或遊戲專用 persistence。
- `api.ui.setRoot` 只驗證／傳輸遊戲端組合的 flat `screen/text/button` tree；UI rect 固定使用 normalized 0..100 × 0..100 logical space，由 host 映射到 viewport，engine 不做 layout、binding、widget 或遊戲規則。
- 不在第一版設計「未來可換任意語言」的 public abstraction；Rust 內部保留 `ScriptHost` 邊界即可。

建議遊戲結構：

```text
game/
├── project.unone.json
├── scripts/
│   ├── main.luau
│   ├── gameplay/
│   ├── ui/
│   └── tests/
├── scenes/
├── assets/
└── generated/
    └── engine.d.luau
```

## 4. Hot Reload 與清除模型

核心規則：

> Engine-owned state survives；script implementation is disposable。

第一版只保證：修改 Luau → check → compile → 建立新 module → 替換 implementation；Entity 的 Rust-owned Component state 保留。暫不搬遷任意 closure、coroutine、call stack 或 VM heap。

每個 script instance 必須有可清理的生命週期：

- `onCreate`
- `onStart`
- `onUpdate`
- `onDestroy`
- `onReload`

事件訂閱、timer、tween 與 callback 都必須隸屬 instance scope，scope 銷毀就全部清除；禁止讓 reload 後的舊 callback 继续寫入新 instance。這是「好 hot reload、好清除」的必要條件。

Reload 失敗時：

1. 新模組在 shadow context 中檢查與載入。
2. 若失敗，保留上一份 module 繼續執行。
3. 回傳原始檔案、行列、Entity、錯誤原因、受影響範圍與下一步建議。
4. 成功後才切換 generation，並記錄 reload event。

### 開發 hot reload、內容 hot update、引擎更新要分開

這三者不能共用一個模糊的 `reload`：

| 類型 | 第一版策略 | 負責者 |
|---|---|---|
| Luau script hot reload | shadow compile/check、safe-frame swap、保留 Engine state | 引擎 runtime |
| 線上內容 hot update | manifest、bundle download/cache/verify、原子啟用與回滾 | 引擎資源 runtime + 業務 catalog |
| Rust engine binary update | 不在 runtime 替換；native 重新發版，Web 重新部署 | 發版流程 |

### Bundle / 分包下載設計

第一版只做必要的內容分發 runtime：

```text
catalog (game-owned)
        ↓ resolve
signed manifest
        ↓ download missing content-addressed bundles
staging cache → hash/signature verify → atomic activate
        ↓
host resolves game-owned asset manifest entries
```

Manifest 至少包含 bundle id、版本、平台、依賴、大小、壓縮格式、content hash 與簽章。Bundle 以 content hash 做 cache key，支援暫存下載、重試與中斷續傳；新版本先寫入 staging，驗證完整後才切換 active pointer。切換失敗保留上一個可運作版本，舊 bundle 在沒有引用後才回收。

native 使用檔案 cache；Web 使用 browser fetch/cache/持久化 adapter。引擎以 `BundleFetcher` 接收 host 提供的 reader，統一負責 streaming verify、staging、cache commit 與 generation activation；fetch、重試、storage quota、背景下載與平台持久化政策留在 host。兩邊共用 manifest、hash、依賴與 Asset API，不把平台儲存細節暴露給 Luau。第一版不做 P2P、差分 patch、遠端腳本執行、原生 plugin 熱插拔或完整 CDN/後台。

遊戲端只描述內容 catalog、預載/按需載入時機與 feature gate；引擎負責安全地下載、驗證、解壓、快取、引用計數與載入。這樣不會把營運規則塞進引擎，也不會讓每款遊戲重寫資源下載器。

### 實務瓶頸與預防設計

| 瓶頸 | 預防 | 不做的過度設計 |
|---|---|---|
| 網路延遲 / 首次啟動慢 | bundle manifest、按需載入、預載提示、可重試 cache | 不在引擎內建 CDN 或 P2P |
| bundle 太碎造成 request 噪音 | 以場景/功能邊界切包，記錄依賴圖與大小 | 不追求每個檔案一包 |
| 更新中斷 / 檔案損壞 | staging、hash/簽章驗證、原子切換、上一版本保留 | 不做複雜資料庫 migration |
| 下載後記憶體尖峰 | streaming、ref-count、明確 unload、bundle budget | 不讓所有資產永久常駐 |
| shader/資源切換卡頓 | 背景準備、safe-frame activate、pipeline warm-up hook | 不先做全平台 shader 魔法兼容 |
| Mobile suspend/resume | 可恢復下載、生命週期事件、啟動時重驗 manifest | 不在引擎保證背景下載政策 |
| Web storage/下載限制 | platform capability report、cache quota 診斷、可清理 cache | 不假設 Web 等同 native filesystem |
| script/asset stale handle | generation、scope、asset lease，失效 handle 回語意診斷 | 不允許舊 callback 靜默寫入新資源 |
| 更新後 replay 不一致 | 測試 artifact 記錄 engine/script/manifest hash | 不承諾不同版本 bit-identical |

Bundle hot update 的驗收重點是「可恢復、可驗證、可觀測」，不是任何檔案都能在任意時刻無痛替換。場景與 prefab 的 live update 先採 transaction/apply-at-safe-point；引擎不偷偷改動正在執行的遊戲規則。

## 5. Developer Protocol：AI 的主要入口

CLI、MCP 與未來 Editor 不各自實作引擎邏輯，而是共用 Developer Protocol。CLI 仍是最容易 debug 的 client；在 protocol、診斷與 headless loop 穩定後，`game mcp` 以 stdio 做薄轉接，讓 MCP host discovery／call 同一批 operation。

傳輸層與命令層分離：native 開發先用 CLI + local process/session transport；Web 之後用 browser bridge。AI 不應依賴某個 GUI 的座標或畫面狀態。

第一批命令控制在小範圍：

```text
game project inspect [--json]
game asset inspect [--json]
game api search <meaning> [--json]
game api describe <name> [--json]
game check [--json]
game run [--headless --frames N --seed N]
game stop
game reload
game observe world|scene|entity <id>
game input action <name> [--state ...]
game capture screenshot
game diagnostics [--json]
game test [name] [--json]
```

目前已實作 `project inspect`、`asset inspect`、`api search`、`api describe` 與 `game mcp` 的最小版本；`asset inspect` 只檢查主場景的靜態 sprite/mesh3d reference，對照遊戲端 manifest、source 檔案與 bundle id，不負責下載、解碼或管理 runtime asset。MCP 提供 initialize、tools/list、tools/call，工具只包裝既有 CLI operation，metadata 仍以少量公開 Engine API 為範圍，不做 Rust 全量反射。`game preview --watch` 是目前可用的持續 session reload 入口；一次性 CLI process 不另外假裝提供無狀態的 `game reload`。

所有命令都要有穩定 exit code、machine-readable JSON 與人類可讀輸出。MCP 只包裝這些 protocol operation，不成為 Engine core 的依賴；第一版不做 resources、prompts、tasks、Streamable HTTP 或長生命週期遊戲 session。

## 6. 語意化 API 與診斷

每個 public API 至少要有：名稱、用途、適用情境、不適用情境、參數與回傳、side effects、frame semantics、常見錯誤、範例、相關 API 與效能注意事項。

診斷不可只回「Invalid operation」。最低模型：

```json
{
  "ok": false,
  "error": {
    "code": "COMPONENT_NOT_FOUND",
    "summary": "Player 沒有 CharacterController",
    "explanation": "腳本要求碰撞式移動，但目前 Entity 只含 Transform、Sprite、Health。",
    "facts": {
      "entity": "Player",
      "requested": "CharacterController",
      "existing": ["Transform", "Sprite", "Health"]
    },
    "likely_causes": ["Component 尚未掛上", "場景載入了錯誤 prefab"],
    "suggested_actions": [
      {"action": "inspect_entity", "command": "game observe entity Player"}
    ],
    "source": {"file": "scripts/gameplay/player.luau", "line": 20}
  }
}
```

`facts` 必須是引擎觀測到的事實；`likely_causes` 是推論；`suggested_actions` 必須能被 protocol 執行或明確標示為人工行動。這能避免「語意化原因」變成沒有根據的漂亮文字。

同一份診斷應可被 CLI、MCP、Editor、CI 與 runtime overlay 使用。錯誤分類與 code 必須可測試，不能只依賴自由文字比對。

## 7. 自動啟動、觀察、測試與迭代

AI 最小閉環：

```text
inspect → search API → edit Luau → check → reload
       → run/headless → inject input → observe
       → capture → test/diagnostics → fix → repeat
```

headless run 至少要能固定：

- seed
- fixed timestep
- input sequence
- frame count
- physics timestep（加入 physics 後）

輸出 semantic state、trace、diagnostics 與 observation digest。相同 seed + 相同輸入在同一平台應可重現；跨平台完全 bit-identical 不先承諾，先做結果層級的 tolerance 與可解釋差異。遊戲端可用 `api.observation.set` 發布 ViewModel 或其他 JSON-like projection，讓 AI/test 不需依賴畫面猜測。

第一版測試使用簡單的 JSON test manifest，結果由引擎輸出 JSON；不要一開始同時維護 Luau DSL 與 YAML schema。當測試需要表達遊戲特有邏輯時，再加入 Luau test API，而不是預先做兩套格式。

Test manifest 可用 `input_sequence` 表達逐 frame 的語意 input snapshot：`actions` 保存遊戲 action，`pointer` 保存已轉換成 world space 的主要 pointer 與 down 狀態；未指定的 frame 視為全放開。這足以驗證蓄力／放開與 replay，不把觸控座標、device scale 或平台事件直接暴露給遊戲規則。

## 8. 資料格式與單一來源

場景與 prefab 先使用 schema-based、diff-friendly 的 JSON source format，穩定的 readable path 與 stable id 並存；日後可生成 binary cache，但 source of truth 不依賴 editor binary state。

Engine API 的 public metadata、Luau 型別、CLI help、MCP tool schema 與文件應由同一份 metadata 生成。MVP 不追求「所有 Rust struct 自動反射」，只涵蓋對遊戲腳本與 Developer Protocol 公開的少量 API。

## 9. 平台策略

```text
同一份 Luau game code
          │
     Rust runtime
     /    |     \
 native  mobile   web
  wgpu   thin      wasm + WebGPU
         wrappers
```

實作順序：Windows native 開發執行檔 → Web smoke build → iOS → Android。這不是降低目標，而是先用最快的回饋迴路驗證引擎契約，再處理 mobile lifecycle、touch、storage、audio 與 packaging。

wgpu 的官方平台矩陣涵蓋 native 的 Vulkan/Metal/DX12 與 WebAssembly 的 WebGPU；它適合作為跨平台 renderer 基礎，但不代表所有 GPU feature 在各平台都等價。因此引擎公開 API 以共同能力為準，平台特有能力必須顯式查詢，不暗中假設可用。

## 10. 引擎端與業務端界線

| 項目 | 引擎端 | 業務端 / 驗證遊戲 |
|---|---|---|
| 2D rendering | Sprite、texture、camera primitive | 關卡美術與排列 |
| movement | Transform、input、collision primitive | 憤怒鳥的拉弓與拋射規則 |
| combat | 可重用 physics/damage primitive | 各遊戲傷害公式、技能、數值 |
| UI | 最小 tree schema validation、snapshot transport | View、ViewModel、rect 組合、hit-test、action、商店、任務、戀愛選項流程 |
| save | serialization/storage primitive | 玩家資料 schema 與何時存檔 |
| network | transport/replication primitive（後期） | RTS、PVP 的同步規則 |
| test | runner、clock、input、observation | 測試場景與驗收條件 |

判斷原則：如果需求只服務一款遊戲，先留在遊戲專案；如果三種以上遊戲重複需要且語意相同，才提煉為引擎能力。

## 10.5 UI 架構：MVVM 只放在 presentation 邊界

MVVM 適合 UI/presentation，但不適合拿來統一整個遊戲引擎。建議分層：

```text
ECS simulation / game state（Luau + engine components）
                  │ typed selectors / commands
                  ▼
Luau ViewModel（畫面投影、UI commands、screen flow）
                  │ explicit bindings
                  ▼
Declarative View（game-composed; engine validates/transports minimal tree）
```

Model 是遊戲的真實狀態，ViewModel 是遊戲端定義的 typed presentation projection，View 是由引擎提供 primitive、由遊戲端組合的 declarative UI。View 不直接修改 ECS，也不把遊戲規則藏進 callback。

這對 AI 友善，因為 AI 可以分別 inspect model、ViewModel 與 UI tree；ViewModel 是小型、typed、可序列化的上下文；commands 有名稱、參數、前置條件、結果與 diagnostics；測試可先驗證 ViewModel，再驗證 View binding。

第一版不做全域 magic binding、雙向自動同步、反射式 converter graph、全引擎 ViewModel registry、layout engine、widget library、UI event bus 或讓每個 Entity 都建立 ViewModel。`api.ui.setRoot` 只提供 flat `screen/text/button` transport；ViewModel、View 組合、hit-test 與 action 仍在遊戲端，高頻 gameplay simulation 維持 ECS。

3D 也遵守同一個最小原則：先只提供被 3D Racing 證明必要的 `Vec3`、`Transform3D`、`Mesh3D`、`Camera3D` 與 semantic snapshot；車輛、賽道、輪胎、material、animation、navigation、3D physics 與完整 asset editor 不預先放進 engine。後續只有在至少多個遊戲出現相同且低階的阻塞時，才依 evidence 提煉下一個 primitive。

## 11. 里程碑與驗收

### M0：引擎骨架

- Cargo workspace、native app、wgpu 視窗。
- ECS/World 的最小可運作版本。
- 2D quad/sprite、Transform、Input。
- 一個 Luau entry script 可驅動物件。

驗收：不用 Editor，`game run` 能啟動範例場景並以鍵盤移動 sprite；`game preview` 能以 native wgpu 視窗顯示同一份 Luau 驅動的 Entity state。

### M1：可迭代腳本

- `game check`、generated Luau types、source location。
- file watcher、module dependency、reload generation。
- reload 失敗保留舊模組；instance scope 可清理。

驗收：修改移動速度或重力後，在不重啟遊戲的前提下看到結果；故意放入型別錯誤時能得到可定位、可行動的診斷。

### M1.5：內容 bundle runtime

- manifest schema、content-addressed bundle cache、依賴解析。
- staging download、hash/簽章驗證、atomic activate、失敗回滾。
- `BundleFetcher` host boundary、native/Web storage adapter contract，以及由遊戲端擁有的 asset reference manifest。
- `game asset inspect` 只驗證 static reference → asset id → source/bundle 的鏈路；只有至少兩款遊戲證明同一套 runtime lease/load/unload 語意必要時，才加入 AssetManager。不要因為目前已有 asset id 就預先建立泛用資產物件系統。

驗收：替換一個 texture/scene bundle 時，host 可提供非檔案 reader；下載中斷或 hash 錯誤不破壞目前版本；成功後下一個 safe point 才看到新內容，並能由 CLI observe bundle 狀態。

### M2：AI 可操作閉環

- headless runner、fixed dt、seed、input injection。
- observe entity/world、screenshot、trace、diagnostics JSON。
- Luau test runner 與 regression artifact。

驗收：AI 或 CLI 能從零啟動、操作、觀察、測試並修正一個 2D 小場景。

### M3：Web 與開發體驗

- WebAssembly/WebGPU smoke build。
- native/web 的 platform capability report。
- 最小 Inspector 只讀取 Developer Protocol。

目前進度：`unone-engine` 已通過 `wasm32-unknown-emscripten` library compile，`unone-web-smoke` 已完成 Emscripten link、Node smoke 與 browser runtime smoke page，且已有 `platform capabilities` CLI query。`web/host/` 已完成 snapshot bridge，`web/live/` 已以窄 C ABI 完成 host-provided source/scene payload、script reload、live WASM frame loop、browser input 驅動同一個 Rust/Luau simulation 與 WebGPU render；sample 的 project bundle/catalog、incremental verify、IndexedDB cache、generation transaction、script hot update 與 Web semantic diagnostic transport 已通過 smoke。新增 `bundle pack`／MCP pack 後，七個正式遊戲都已有最小 project/script/scene manifest；`web/runner/` 已用每個遊戲獨立的 IndexedDB generation 與 save store 實際載入七款遊戲，並消費 2D/3D snapshot、semantic UI 與完整 `InputFrame`；3D Racing 另已驗證 generation 1→2 的內容變更 script hot update 與 save reload。Android 的 `aarch64-linux-android` 與 `x86_64-linux-android` engine cross-compile、headless mobile FFI lifecycle smoke，以及以同一 FFI 建立並在 API 34 `Pixel_8` emulator 啟動的最小 APK host smoke 都已通過；後者包含 project payload、Canvas entity snapshot、前景 Activity、pause/resume 與觸控可視化。通用 asset streaming、production CDN/quota policy、production Android renderer/bundle host、iOS host、各遊戲 native/iOS/Android game smoke 與最小 Inspector 仍未完成，不能把這個里程碑標成完成。

### M4：憤怒鳥 2D 驗證

在 `D:/Projects/Unone_Games/` 建立獨立遊戲專案。它不是把遊戲規則塞回引擎，而是用來壓測：2D physics、camera、input recording、scene/prefab、asset pipeline、UI、hot reload、headless test 與 AI 教學。

驗收標準不是「畫面像不像」，而是 AI 能否依文件完成一個功能、遇到錯誤能否自行定位、修改後能否以測試與截圖證明結果。

### M5：mobile 與長期能力

先完成 Android host 的可取得工具鏈與 lifecycle smoke，再在 macOS/Xcode 環境完成 iOS host；之後依目標遊戲的真實阻塞增加 3D、audio、animation、save、networking、performance tooling。engine cross-compile 不是 host 完成的替代證據。

## 12. 長期遊戲驗證順序與通過門檻

七種遊戲不是靈感清單，而是引擎的正式驗收 gate。只有七種遊戲都能以引擎完成可玩的驗證版本，並通過各自的測試、跨平台 smoke test、AI 開發閉環與問題回饋檢查，才算引擎通過長期目標。

不要求第一天就做七款完整商業產品；按下列順序逐項驗證能力：

1. 憤怒鳥 2D：2D physics、trajectory、camera、input replay。
2. AVG 戀愛遊戲：dialogue、資料驅動流程、存檔、UI、文字資產。
3. 刀塔傳奇式放置戰鬥：timer、combat simulation、數值測試、批次模擬。
4. 老虎機 / 魚機：deterministic RNG、UI、結果解釋與測試；真實金流與營運不屬引擎。
5. 自走棋：board state、rule system、AI simulation、replay。
6. 紅色警戒式 RTS：大量 Entity、pathfinding、fog/command、networking 壓力。
7. 3D 賽車：3D renderer、vehicle physics、camera、mobile performance。

每個驗證遊戲的最低通過條件：

- 可從專案檔啟動，不依賴人工操作特定 Editor 狀態。
- 主要玩法由引擎 API + 遊戲端 Luau 完成，沒有把遊戲規則硬編進 Rust。
- 至少有一條 deterministic headless regression test。
- AI 能透過 CLI/Developer Protocol inspect、修改、reload、run、observe、diagnose。
- 至少完成 native 與 Web smoke test；若該階段已開通 mobile，加入 iOS/Android smoke test。
- 有開發日誌、問題分類、修正證據與截圖；教學中的命令必須能在乾淨環境重跑。

只有被至少兩個專案證明的共同能力，才提煉進引擎。這可避免為了想像中的未來需求把 core 做成無法使用的抽象層。

## 13. 問題、決策與開發紀錄

所有開發工作都留下三類紀錄：

- `docs/devlog/`：做了什麼、觀察到什麼、測試輸出與截圖路徑。
- `docs/issues/`：問題、影響範圍、分類、證據、修正、回歸測試。
- `docs/decisions/`：重要架構決策、替代方案、為何選擇、何時重開決策。

問題先按影響範圍分類：

| 分類 | 判斷 | 解法 |
|---|---|---|
| Game logic | 單一遊戲規則或資料錯 | 改 `Unone_Games` 的 Luau/內容 |
| Engine contract | API 行為、生命週期或診斷與文件不一致 | 改引擎、測試與文件 |
| Architecture | 多平台、reload、觀察或重用需求反覆卡住 | 改架構，不在業務端打補丁 |
| Tooling/docs | CLI、MCP、教學有雜訊或無法操作 | 改 protocol、metadata、教學 |

每個 issue 至少記錄：重現步驟、預期/實際、受影響平台與專案、證據（log/JSON/screenshot）、分類理由、修正、回歸測試與是否更新教學。錯誤資訊若被證明不正確，要刪除或修正來源，不保留在文件中製造雜訊。

## 14. 第一個實作切片

接下來不要先做 MCP 或完整 Editor，先完成以下垂直切片：

1. `unone` native app 建立視窗並畫一個可移動的 2D sprite。
2. `main.luau` 以 `--!strict` 控制移動。
3. `game check` 輸出 JSON 型別錯誤與 source location。
4. 修改腳本後 `game reload`，保留 Transform state。
5. `game run --headless --frames 60 --seed 42` 輸出 entity observation。
6. 一個 test 驗證 sprite 在固定輸入下到達預期位置。
7. 將一次成功與一次失敗迭代寫入 devlog，附 terminal output 與 screenshot。

完成這條切片後，再依真實阻塞決定 physics 與 Web 的先後；在此之前不擴增 crate 數量、不做泛用 editor、不做 MCP 特殊邏輯。

## 15. 目前結論

保留參考初稿的核心判斷：Rust/Luau 分層、wgpu 跨平台基礎、CLI-first、語意診斷、semantic observation、deterministic test、hot reload 與 schema metadata。

本版的重要修正是：先做能被憤怒鳥 2D 驗證的最小遊戲引擎；把 MCP、Editor、3D、network、完整 reflection 與多 domain 安全模型放到有證據的階段；熱更只先做腳本與必要的內容 bundle runtime；MVVM 只用於 Luau UI/presentation；不建立沒有使用者的抽象。引擎要保持像遊戲引擎，而不是變成 AI workflow 平台。

## 參考

- [Luau types](https://luau.org/types/)
- [Luau getting started](https://luau.org/getting-started/)
- [Luau C API](https://luau.org/api/)
- [wgpu repository and supported platforms](https://github.com/gfx-rs/wgpu)
