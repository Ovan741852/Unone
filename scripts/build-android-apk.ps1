param(
    [string]$ProjectRoot = "D:/Projects/Unone_Games/angry-birds-2d",
    [string]$Target = "x86_64-linux-android",
    [string]$NdkPath = "",
    [string]$OutputPath = "artifacts/unone-android-host.apk"
)

$ErrorActionPreference = "Stop"

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$androidRoot = Join-Path $repoRoot "platform/android"
$buildRoot = [IO.Path]::GetFullPath((Join-Path $androidRoot "build/$Target"))
if (-not $buildRoot.StartsWith([IO.Path]::GetFullPath($androidRoot), [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a build directory outside platform/android."
}
if (Test-Path -LiteralPath $buildRoot) { Remove-Item -LiteralPath $buildRoot -Recurse -Force }
New-Item -ItemType Directory -Path $buildRoot | Out-Null

$sdkPath = $env:ANDROID_HOME
if ([string]::IsNullOrWhiteSpace($sdkPath)) { $sdkPath = $env:ANDROID_SDK_ROOT }
if ([string]::IsNullOrWhiteSpace($sdkPath)) { throw "ANDROID_HOME or ANDROID_SDK_ROOT is required." }

if ([string]::IsNullOrWhiteSpace($NdkPath)) {
    $NdkPath = Get-ChildItem -LiteralPath (Join-Path $sdkPath "ndk") -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName "toolchains/llvm/prebuilt/windows-x86_64/bin") } |
        Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ([string]::IsNullOrWhiteSpace($NdkPath)) { throw "No usable Android NDK was found." }

switch ($Target) {
    "x86_64-linux-android" { $clangPrefix = "x86_64-linux-android"; $abi = "x86_64" }
    "aarch64-linux-android" { $clangPrefix = "aarch64-linux-android"; $abi = "arm64-v8a" }
    default { throw "Unsupported Android target: $Target" }
}
$llvmBin = Join-Path $NdkPath "toolchains/llvm/prebuilt/windows-x86_64/bin"
$apiLevel = Get-ChildItem -LiteralPath $llvmBin -Filter "$clangPrefix*-clang.cmd" |
    ForEach-Object { if ($_.Name -match "android(\d+)-clang\.cmd$") { [int]$Matches[1] } } |
    Sort-Object -Descending | Select-Object -First 1
if ($null -eq $apiLevel) { throw "No Android clang wrapper found for $Target." }
$cc = Join-Path $llvmBin "$clangPrefix$apiLevel-clang.cmd"
$targetKey = $Target.Replace('-', '_').ToUpperInvariant()
[Environment]::SetEnvironmentVariable("CC_$($Target.Replace('-', '_'))", $cc, "Process")
[Environment]::SetEnvironmentVariable("CXX_$($Target.Replace('-', '_'))", (Join-Path $llvmBin "$clangPrefix$apiLevel-clang++.cmd"), "Process")
[Environment]::SetEnvironmentVariable("AR_$($Target.Replace('-', '_'))", (Join-Path $llvmBin "llvm-ar.exe"), "Process")
[Environment]::SetEnvironmentVariable("CARGO_TARGET_${targetKey}_LINKER", $cc, "Process")

$project = [IO.Path]::GetFullPath($ProjectRoot)
$configPath = Join-Path $project "project.unone.json"
if (-not (Test-Path -LiteralPath $configPath)) { throw "Project config not found: $configPath" }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$scriptPath = Join-Path $project $config.entry_script
$assetRoot = Join-Path $buildRoot "package/assets"
New-Item -ItemType Directory -Path $assetRoot -Force | Out-Null
$projectJson = ConvertTo-Json -InputObject ([string]$config.name) -Compress
$scriptJson = ConvertTo-Json -InputObject ([IO.File]::ReadAllText($scriptPath)) -Compress
$sceneJson = "null"
if ($config.main_scene) {
    $sceneText = [IO.File]::ReadAllText((Join-Path $project $config.main_scene)).Trim()
    $null = $sceneText | ConvertFrom-Json
    $sceneJson = $sceneText
}
# Keep the scene as validated source JSON. Re-serializing a PSCustomObject with
# ConvertTo-Json -Depth 100 can recurse through PowerShell metadata and consume
# unbounded memory on Windows PowerShell; the host payload needs no such model.
$payloadText = '{"project":' + $projectJson + ',"script":' + $scriptJson + ',"scene":' + $sceneJson + '}'
[IO.File]::WriteAllText((Join-Path $assetRoot "unone-project.json"), $payloadText, [Text.UTF8Encoding]::new($false))

Write-Output "Building Rust mobile FFI: $Target"
cargo build -p unone-mobile-ffi --target $Target
if ($LASTEXITCODE -ne 0) { throw "Rust mobile FFI build failed." }
$rustLib = Join-Path $repoRoot "target/$Target/debug"
$mobileLibrary = Join-Path $rustLib "libunone_mobile_ffi.so"
if (-not (Test-Path -LiteralPath $mobileLibrary)) { throw "Rust mobile library not found: $mobileLibrary" }

$javaHome = $env:JAVA_HOME
if ([string]::IsNullOrWhiteSpace($javaHome) -or -not (Test-Path (Join-Path $javaHome "bin/javac.exe"))) {
    $javaHome = Get-ChildItem "C:/Program Files/Java" -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "bin/javac.exe") } |
        Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ([string]::IsNullOrWhiteSpace($javaHome)) { throw "A JDK with javac/jar was not found." }
$javac = Join-Path $javaHome "bin/javac.exe"
$jar = Join-Path $javaHome "bin/jar.exe"
$keytool = Join-Path $javaHome "bin/keytool.exe"
$androidJar = Join-Path $sdkPath "platforms/android-35/android.jar"
$buildTools = Join-Path $sdkPath "build-tools/36.0.0"
$aapt2 = Join-Path $buildTools "aapt2.exe"
$d8 = Join-Path $buildTools "d8.bat"
$zipalign = Join-Path $buildTools "zipalign.exe"
$apksigner = Join-Path $buildTools "apksigner.bat"
foreach ($tool in @($javac, $jar, $keytool, $androidJar, $aapt2, $d8, $zipalign, $apksigner)) {
    if (-not (Test-Path -LiteralPath $tool)) { throw "Android/JDK tool not found: $tool" }
}

$classes = Join-Path $buildRoot "classes"
New-Item -ItemType Directory -Path $classes -Force | Out-Null
$javaFiles = Get-ChildItem -LiteralPath (Join-Path $androidRoot "src") -Recurse -Filter "*.java" | Select-Object -ExpandProperty FullName
& $javac -source 8 -target 8 -classpath $androidJar -d $classes $javaFiles
if ($LASTEXITCODE -ne 0) { throw "Android Java compile failed." }

$nativeDir = Join-Path $buildRoot "package/lib/$abi"
New-Item -ItemType Directory -Path $nativeDir -Force | Out-Null
Copy-Item -LiteralPath $mobileLibrary -Destination (Join-Path $nativeDir "libunone_mobile_ffi.so") -Force
$sharedCpp = Join-Path $NdkPath "toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/$clangPrefix/libc++_shared.so"
if (Test-Path -LiteralPath $sharedCpp) { Copy-Item -LiteralPath $sharedCpp -Destination (Join-Path $nativeDir "libc++_shared.so") -Force }
$hostLibrary = Join-Path $nativeDir "libunone_android_host.so"
$ndkJniInclude = Join-Path $NdkPath "toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/include"
& $cc -shared -fPIC "-I$ndkJniInclude" "-I$(Join-Path $repoRoot "crates/unone-mobile-ffi/include")" -L $rustLib -o $hostLibrary (Join-Path $androidRoot "native/unone_android_host.c") '-l:libunone_mobile_ffi.so'
if ($LASTEXITCODE -ne 0) { throw "Android JNI host compile failed." }

$dex = Join-Path $buildRoot "dex"
New-Item -ItemType Directory -Path $dex -Force | Out-Null
$classFiles = Get-ChildItem -LiteralPath $classes -Recurse -Filter "*.class" | Select-Object -ExpandProperty FullName
& $d8 --lib $androidJar --output $dex $classFiles
if ($LASTEXITCODE -ne 0) { throw "D8 dex build failed." }

$baseApk = Join-Path $buildRoot "base.apk"
& $aapt2 link -o $baseApk -I $androidJar --manifest (Join-Path $androidRoot "AndroidManifest.xml") --min-sdk-version 26 --target-sdk-version 35 --version-code 1 --version-name 0.1
if ($LASTEXITCODE -ne 0) { throw "aapt2 package link failed." }
$jarArgs = @("uf", $baseApk, "-C", $dex, "classes.dex", "-C", (Join-Path $buildRoot "package"), "assets/unone-project.json", "-C", (Join-Path $buildRoot "package"), "lib/$abi/libunone_mobile_ffi.so", "-C", (Join-Path $buildRoot "package"), "lib/$abi/libunone_android_host.so")
if (Test-Path (Join-Path $nativeDir "libc++_shared.so")) { $jarArgs += @("-C", (Join-Path $buildRoot "package"), "lib/$abi/libc++_shared.so") }
& $jar @jarArgs
if ($LASTEXITCODE -ne 0) { throw "APK zip assembly failed." }

$alignedApk = Join-Path $buildRoot "aligned.apk"
& $zipalign -f 4 $baseApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "APK zipalign failed." }
$keystore = Join-Path $androidRoot "debug.keystore"
if (-not (Test-Path -LiteralPath $keystore)) {
    & $keytool -genkeypair -keystore $keystore -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Unone,C=TW"
    if ($LASTEXITCODE -ne 0) { throw "Debug keystore creation failed." }
}
$output = [IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
New-Item -ItemType Directory -Path (Split-Path $output -Parent) -Force | Out-Null
& $apksigner sign --ks $keystore --ks-pass pass:android --key-pass pass:android --out $output $alignedApk
if ($LASTEXITCODE -ne 0) { throw "APK signing failed." }
& $apksigner verify --verbose $output
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed." }
Write-Output "Android APK built: $output"
