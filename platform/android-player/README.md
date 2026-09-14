# Offline Android player

This APK host embeds a verified single-game Web export and runs its release WASM,
Three.js WebGL, UI, audio and native particle implementation in Android System
WebView. It is **not** `export platform --target android-x86_64` / `android-arm64`
(those are wgpu NativeActivity). Android's installed WebView supplies the CPU/GPU backend, so the APK has
no architecture-specific native library. Android 14 with WebView 137 was tested;
physical devices and older WebViews still need compatibility validation.

```powershell
./scripts/build-android-player.ps1 -ExportRoot _Games/dragon-tycoon3/dist/web `
  -OutputPath _Games/dragon-tycoon3/dist/dragon-tycoon3-android.apk `
  -ApplicationId com.unone.dragontycoon3 -AppName '獵龍戰紀 3 · Unone'
```

Requires the Android 35 SDK platform, build-tools 36.0.0 and JDK 17. The script
checks every export file hash, packages only inventoried files, verifies APK
signatures and writes an adjacent JSON size/hash report. Choose an unused APK
output path. Signing uses the local test key; store publication requires a proper
application signing/release process.

The APK has no INTERNET permission. `shouldInterceptRequest` serves packaged
content at `https://appassets.androidplatform.net`; external requests fail closed,
and file/content URL access is disabled. This follows Android's
[local-content HTTPS origin approach](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content).
JavaScript has no Java bridge. WebView inspection is disabled in the packaged app.

Activity pause/resume forwards explicit host events to the shared fixed-step
scheduler and clears held input. Game saves remain in origin-local storage.
The separate native Canvas/JNI smoke remains a different host; this APK does not
add native mesh/skinning renderers to it.
