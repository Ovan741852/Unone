# Mobile host included in the AI package

The AI engine package includes a generic Android lifecycle smoke host. A game
subagent can build and run it using only the package, its own game output, and
an Android SDK/JDK/NDK environment; it does not need engine source or another
game implementation.

The current shipped APK host target is `x86_64` for an emulator. It loads the
game's `project.unone.json`, entry script (defaulting to `scripts/main.luau`),
and main scene through the same `unone-mobile-ffi` ABI. The host proves package
load, JNI boundary, input/lifecycle process, pause/resume, and semantic runtime
startup. Its Canvas drawing is still smoke-only: it is not the production
renderer, asset decoder, CDN/bundle downloader, or final content presentation.

From the package root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android-package.ps1 `
  -GameProjectRoot D:/path/to/game-output `
  -OutputPath .unone/android/unone-android-host.apk
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-android-package-smoke.ps1 `
  -ApkPath D:/path/to/game-output/.unone/android/unone-android-host.apk
```

If no emulator/device is available, record `ANDROID_HOST_UNAVAILABLE` as a
host blocker; do not replace it with a cross-compile claim. The package does
not include an executable iOS host because iOS signing/build/runtime requires
macOS/Xcode. The iOS host remains a main-project platform blocker until that
environment is available.
