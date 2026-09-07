param(
    [Parameter(Mandatory = $true)]
    [string]$GameProjectRoot,
    [string]$Target = "x86_64",
    [string]$OutputPath = ".unone\android\unone-android-host.apk"
)

$ErrorActionPreference = "Stop"
$packageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$gameRoot = [IO.Path]::GetFullPath($GameProjectRoot)
if (-not (Test-Path -LiteralPath $gameRoot -PathType Container)) {
    throw "Game project directory not found: $gameRoot"
}
if ($Target -ne "x86_64") {
    throw "This package currently ships only the x86_64 Android smoke host. Use -Target x86_64."
}

$configPath = Join-Path $gameRoot "project.unone.json"
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Project config not found: $configPath"
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$entryScript = if ([string]::IsNullOrWhiteSpace([string]$config.entry_script)) {
    "scripts/main.luau"
} else {
    [string]$config.entry_script
}
$scriptPath = Join-Path $gameRoot $entryScript
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw "Entry script not found: $scriptPath"
}
$projectJson = ConvertTo-Json -InputObject ([string]$config.name) -Compress
$scriptJson = ConvertTo-Json -InputObject ([IO.File]::ReadAllText($scriptPath)) -Compress
$sceneJson = "null"
if (-not [string]::IsNullOrWhiteSpace([string]$config.main_scene)) {
    $scenePath = Join-Path $gameRoot ([string]$config.main_scene)
    if (-not (Test-Path -LiteralPath $scenePath -PathType Leaf)) {
        throw "Main scene not found: $scenePath"
    }
    $sceneText = [IO.File]::ReadAllText($scenePath).Trim()
    $null = $sceneText | ConvertFrom-Json
    $sceneJson = $sceneText
}

$buildRoot = Join-Path $gameRoot ".unone\android-build\$Target"
$gameRootCanonical = [IO.Path]::GetFullPath($gameRoot).TrimEnd('\') + '\'
$buildRootCanonical = [IO.Path]::GetFullPath($buildRoot)
if (-not $buildRootCanonical.StartsWith($gameRootCanonical, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to build outside the game project: $buildRootCanonical"
}
if (Test-Path -LiteralPath $buildRoot) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
$packageDir = Join-Path $buildRoot "package"
New-Item -ItemType Directory -Path (Join-Path $packageDir "assets") -Force | Out-Null
$systemsJson = if ($config.systems) { ConvertTo-Json -InputObject $config.systems -Depth 8 -Compress } else { "{}" }
$audioJson = if ($config.audio) { ConvertTo-Json -InputObject $config.audio -Depth 12 -Compress } else { "null" }
$payloadText = '{"project":' + $projectJson + ',"script":' + $scriptJson + ',"scene":' + $sceneJson + ',"systems":' + $systemsJson + ',"audio":' + $audioJson + '}'
[IO.File]::WriteAllText((Join-Path $packageDir "assets\unone-project.json"), $payloadText, [Text.UTF8Encoding]::new($false))

$androidRoot = Join-Path $packageRoot "mobile\android-host"
$manifest = Join-Path $androidRoot "AndroidManifest.xml"
$classes = Join-Path $androidRoot "classes.dex"
$nativeRoot = Join-Path $androidRoot "lib\x86_64"
foreach ($required in @($manifest, $classes, (Join-Path $nativeRoot "libunone_mobile_ffi.so"), (Join-Path $nativeRoot "libunone_android_host.so"), (Join-Path $nativeRoot "libc++_shared.so"), (Join-Path $androidRoot "debug.keystore"))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Package Android host input is missing: $required"
    }
}
$nativePackage = Join-Path $packageDir "lib\x86_64"
New-Item -ItemType Directory -Path $nativePackage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $androidRoot "debug.keystore") -Destination (Join-Path $buildRoot "debug.keystore")
Copy-Item -LiteralPath (Join-Path $nativeRoot "libunone_mobile_ffi.so") -Destination $nativePackage
Copy-Item -LiteralPath (Join-Path $nativeRoot "libunone_android_host.so") -Destination $nativePackage
Copy-Item -LiteralPath (Join-Path $nativeRoot "libc++_shared.so") -Destination $nativePackage

$sdkPath = $env:ANDROID_HOME
if ([string]::IsNullOrWhiteSpace($sdkPath)) { $sdkPath = $env:ANDROID_SDK_ROOT }
if ([string]::IsNullOrWhiteSpace($sdkPath)) { throw "ANDROID_HOME or ANDROID_SDK_ROOT is required." }
$platform = Get-ChildItem -LiteralPath (Join-Path $sdkPath "platforms") -Directory |
    Sort-Object Name -Descending | Select-Object -First 1
$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdkPath "build-tools") -Directory |
    Sort-Object Name -Descending | Select-Object -First 1
if ($null -eq $platform -or $null -eq $buildTools) { throw "Android SDK platform/build-tools not found." }
$androidJar = Join-Path $platform.FullName "android.jar"
$aapt2 = Join-Path $buildTools.FullName "aapt2.exe"
$zipalign = Join-Path $buildTools.FullName "zipalign.exe"
$apksigner = Join-Path $buildTools.FullName "apksigner.bat"
foreach ($tool in @($androidJar, $aapt2, $zipalign, $apksigner)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Android SDK tool not found: $tool" }
}

$baseApk = Join-Path $buildRoot "base.apk"
& $aapt2 link -o $baseApk -I $androidJar --manifest $manifest --min-sdk-version 26 --target-sdk-version 35 --version-code 1 --version-name 0.1
if ($LASTEXITCODE -ne 0) { throw "aapt2 package link failed." }
$javaHome = $env:JAVA_HOME
if ([string]::IsNullOrWhiteSpace($javaHome) -or -not (Test-Path -LiteralPath (Join-Path $javaHome "bin\jar.exe") -PathType Leaf)) {
    $javaHome = Get-ChildItem "C:/Program Files/Java" -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "bin\jar.exe") } |
        Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ([string]::IsNullOrWhiteSpace($javaHome)) { throw "A JDK with JAVA_HOME/bin/jar.exe is required for the Android package host." }
$jarPath = Join-Path $javaHome "bin\jar.exe"
if (-not (Test-Path -LiteralPath $jarPath -PathType Leaf)) { throw "JAVA_HOME/bin/jar.exe is required." }
$jarArgs = @(
    "uf", $baseApk,
    "-C", (Join-Path $androidRoot "."), "classes.dex",
    "-C", $packageDir, "assets/unone-project.json",
    "-C", $packageDir, "lib/x86_64/libunone_mobile_ffi.so",
    "-C", $packageDir, "lib/x86_64/libunone_android_host.so",
    "-C", $packageDir, "lib/x86_64/libc++_shared.so"
)
& $jarPath @jarArgs
if ($LASTEXITCODE -ne 0) { throw "APK zip assembly failed." }

$alignedApk = Join-Path $buildRoot "aligned.apk"
& $zipalign -f 4 $baseApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw "APK zipalign failed." }
$output = if ([IO.Path]::IsPathRooted($OutputPath)) {
    [IO.Path]::GetFullPath($OutputPath)
} else {
    [IO.Path]::GetFullPath((Join-Path $gameRoot $OutputPath))
}
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
& $apksigner sign --ks (Join-Path $buildRoot "debug.keystore") --ks-pass pass:android --key-pass pass:android --out $output $alignedApk
if ($LASTEXITCODE -ne 0) { throw "APK signing failed." }
& $apksigner verify --verbose $output
if ($LASTEXITCODE -ne 0) { throw "APK signature verification failed." }
Write-Output "Android package host built: $output"
