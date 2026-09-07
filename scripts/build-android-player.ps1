param(
    [Parameter(Mandatory=$true)][string]$ExportRoot,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [string]$ApplicationId = 'com.unone.player',
    [string]$AppName = 'Unone Player'
)
$ErrorActionPreference = 'Stop'
if ($ApplicationId -notmatch '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$') { throw 'Invalid Android application ID.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$export = (Resolve-Path -LiteralPath $ExportRoot).Path
$output = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $output) { throw "Output already exists: $output" }
$manifest = Get-Content -LiteralPath (Join-Path $export 'export.json') -Raw | ConvertFrom-Json
if ($manifest.profile -ne 'release' -or $manifest.dev_tools -ne $false) { throw 'Requires a release player export without dev-tools.' }
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) { throw 'ANDROID_HOME or ANDROID_SDK_ROOT is required.' }
$javaHome = $env:JAVA_HOME
if (-not $javaHome) { $javaHome = Get-ChildItem 'C:/Program Files/Java' -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'bin/javac.exe') } | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName }
$buildTools = Join-Path $sdk 'build-tools/36.0.0'
$androidJar = Join-Path $sdk 'platforms/android-35/android.jar'
$javac = Join-Path $javaHome 'bin/javac.exe'
$jar = Join-Path $javaHome 'bin/jar.exe'
$keytool = Join-Path $javaHome 'bin/keytool.exe'
$aapt = Join-Path $buildTools 'aapt2.exe'
$d8 = Join-Path $buildTools 'd8.bat'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$signer = Join-Path $buildTools 'apksigner.bat'
foreach ($tool in @($androidJar,$javac,$jar,$keytool,$aapt,$d8,$zipalign,$signer)) {
    if (-not (Test-Path -LiteralPath $tool)) { throw "Required Android build tool missing: $tool" }
}
$build = Join-Path $repoRoot ('platform/android/build/player-' + [Guid]::NewGuid().ToString('N'))
$assets = Join-Path $build 'package/assets/player'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
$prefix = $export.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
$destinations = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($entry in $manifest.files) {
    if ([IO.Path]::IsPathRooted($entry.path) -or $entry.path -match '(^|[/\\])\.\.([/\\]|$)') { throw "Unsafe export path: $($entry.path)" }
    $source = [IO.Path]::GetFullPath((Join-Path $export $entry.path))
    if (-not $source.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw "Export path escapes root: $source" }
    if (-not $destinations.Add($source)) { throw "Duplicate export path: $source" }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Export hash mismatch: $($entry.path)" }
    $destination = Join-Path $assets $entry.path
    New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}
foreach ($required in @('index.html','content/project.json','runtime/runtime.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $assets $required))) { throw "Export is missing $required" }
}
$sourceRoot = Join-Path $repoRoot 'platform/android-player'
$xml = [IO.File]::ReadAllText((Join-Path $sourceRoot 'AndroidManifest.xml')).Replace('__APPLICATION_ID__',$ApplicationId).Replace('__APP_NAME__',[Security.SecurityElement]::Escape($AppName))
$manifestPath = Join-Path $build 'AndroidManifest.xml'
[IO.File]::WriteAllText($manifestPath,$xml,[Text.UTF8Encoding]::new($false))
$classes = Join-Path $build 'classes'
$dex = Join-Path $build 'dex'
New-Item -ItemType Directory -Path $classes,$dex | Out-Null
$javaFiles = @(Get-ChildItem (Join-Path $sourceRoot 'src') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName)
& $javac -encoding UTF-8 -source 8 -target 8 -classpath $androidJar -d $classes $javaFiles
if ($LASTEXITCODE -ne 0) { throw 'Player Java compilation failed.' }
$classFiles = @(Get-ChildItem $classes -Recurse -Filter '*.class' | Select-Object -ExpandProperty FullName)
& $d8 --min-api 26 --lib $androidJar --output $dex $classFiles
if ($LASTEXITCODE -ne 0) { throw 'Player DEX compilation failed.' }
$base = Join-Path $build 'base.apk'
& $aapt link -o $base -I $androidJar --manifest $manifestPath --min-sdk-version 26 --target-sdk-version 35 --version-code 1 --version-name 0.1
if ($LASTEXITCODE -ne 0) { throw 'Player manifest linking failed.' }
& $jar uf $base -C $dex classes.dex -C (Join-Path $build 'package') assets
if ($LASTEXITCODE -ne 0) { throw 'Player APK assembly failed.' }
$aligned = Join-Path $build 'aligned.apk'
& $zipalign -f 4 $base $aligned
if ($LASTEXITCODE -ne 0) { throw 'Player APK alignment failed.' }
$keystore = Join-Path $repoRoot 'platform/android/debug.keystore'
if (-not (Test-Path -LiteralPath $keystore)) {
    & $keytool -genkeypair -keystore $keystore -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Unone,C=TW'
    if ($LASTEXITCODE -ne 0) { throw 'Local test signing key creation failed.' }
}
New-Item -ItemType Directory -Force -Path (Split-Path $output -Parent) | Out-Null
& $signer sign --ks $keystore --ks-pass pass:android --key-pass pass:android --out $output $aligned
if ($LASTEXITCODE -ne 0) { throw 'Player APK signing failed.' }
& $signer verify --verbose $output
if ($LASTEXITCODE -ne 0) { throw 'Player APK signature verification failed.' }
$report = @{ application_id=$ApplicationId; app_name=$AppName; host='offline-webview'; signing='local-test-key'; abi='uses-device-system-webview'; network_permission=$false; player_profile='release'; dev_tools=$false; bytes=(Get-Item $output).Length; sha256=(Get-FileHash $output -Algorithm SHA256).Hash.ToLowerInvariant(); export_manifest_sha256=(Get-FileHash (Join-Path $export 'export.json') -Algorithm SHA256).Hash.ToLowerInvariant() }
[IO.File]::WriteAllText(($output+'.json'),($report | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Write-Output "Android player built: $output"
