# Generic Web game runner

這個 host 用來把 `D:/Projects/Unone_Games/` 的 business slice 接到同一個 Emscripten/Wasm runtime，避免每款遊戲各自複製一套 Web engine adapter。

建置 engine 的 live WASM 後，從 `D:/Projects` 啟動本地 server：

```powershell
cd D:/Projects
python -m http.server 8000
```

開啟：

```text
http://127.0.0.1:8000/Unone/web/runner/?project=/Unone_Games/3d-racing/
http://127.0.0.1:8000/Unone/web/runner/?project=/Unone_Games/red-alert-rts/
http://127.0.0.1:8000/Unone/web/runner/?project=/Unone_Games/fish-machine/
```

host 先讀取 project config 找到 `bundle_manifest`，再透過 `web/live/bundle-store.js` 以每個 project 各自的 IndexedDB database 安裝／快取／驗證 generation，最後從 active generation 讀取 project、script、scene。`source` 由 host 以遊戲專案根目錄解析，因為 engine/native manifest 使用的是 project-root-relative 路徑。按 `Install / reload active bundle` 可重跑 manifest 安裝並將 active script 送入同一個 runtime 的 Luau hot reload；若專案未設定 manifest，才 fallback 到直接讀 source。UI tree、semantic observation、2D/3D debug geometry 仍由同一個 host 消費；button click 與鍵盤 action 會轉成 `InputFrame`。save payload 由遊戲端產生，runner 以每個 project 獨立的 IndexedDB save store 持久化，只作 host smoke，不替遊戲判斷 schema/version/migration。

這不是 production CDN/bundle host，也不取代 `web/live/` 的 rollback fixture；目前已共用 bundle verifier、content-addressed generation、IndexedDB bundle adapter 與 IndexedDB save adapter，但仍需 production CDN/OPFS writer、大檔串流、下載重試/配額政策、production content hot-update/rollback fixture 與正式 mobile host policy。
