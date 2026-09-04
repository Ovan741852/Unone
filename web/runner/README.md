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

host 讀取 project config、scene 與 Luau source，並把 UI tree、semantic observation、2D/3D debug geometry 畫出來；button click 與鍵盤 action 會轉成 `InputFrame`。`localStorage` 只作本機 smoke 的 save adapter。

這不是 production CDN/bundle host，也不取代 `web/live/` 的 content-addressed bundle generation/rollback smoke；production 仍需把 bundle manifest、驗證、IndexedDB/OPFS writer、hot update 與 host policy 接回同一個 loading boundary。
