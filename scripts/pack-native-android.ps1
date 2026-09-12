param(
 [Parameter(Mandatory=$true)][string]$ContentRoot,
 [Parameter(Mandatory=$true)][string]$RuntimeRoot,
 [ValidateSet('android-arm64','android-x86_64')][string]$Target,
 [string]$AppName='Unone Native Player',
 [string]$ApplicationId='com.unone.nativeplayer'
)
$ErrorActionPreference='Stop'
# Windows PowerShell/.NET Framework tools require ordinary drive paths.
$ContentRoot=$ContentRoot -replace '^\\\\\?\\',''
$RuntimeRoot=$RuntimeRoot -replace '^\\\\\?\\',''
function FileSha256([string]$Path) {
 $stream=[IO.File]::OpenRead($Path);$hash=[Security.Cryptography.SHA256]::Create()
 try { return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
 finally {$stream.Dispose();$hash.Dispose()}
}
if($ApplicationId -notmatch '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'){throw 'Invalid application ID'}
$content=(Resolve-Path -LiteralPath $ContentRoot).Path
$runtime=(Resolve-Path -LiteralPath $RuntimeRoot).Path
$sdk=$env:ANDROID_HOME;if(!$sdk){$sdk=$env:ANDROID_SDK_ROOT};if(!$sdk){throw 'ANDROID_HOME required'}
$java=$env:JAVA_HOME;if(!$java){$java=Get-ChildItem 'C:/Program Files/Java' -Directory | Where-Object {Test-Path (Join-Path $_.FullName 'bin/javac.exe')} | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName}
$tools=Join-Path $sdk 'build-tools/36.0.0';$androidJar=Join-Path $sdk 'platforms/android-35/android.jar'
$aapt=Join-Path $tools 'aapt2.exe';$align=Join-Path $tools 'zipalign.exe';$signer=Join-Path $tools 'apksigner.bat';$jar=Join-Path $java 'bin/jar.exe';$keytool=Join-Path $java 'bin/keytool.exe'
foreach($file in @($aapt,$align,$signer,$jar,$keytool,$androidJar)){if(!(Test-Path -LiteralPath $file)){throw "Required Android/JDK tool missing: $file"}}
$build=Join-Path ([IO.Path]::GetTempPath()) ('unone-native-apk-'+[Guid]::NewGuid().ToString('N'))
$assets=Join-Path $build 'assets/player';$abi=if($Target -eq 'android-arm64'){'arm64-v8a'}else{'x86_64'};$lib=Join-Path $build "lib/$abi"
New-Item -ItemType Directory -Path $assets,$lib | Out-Null
Copy-Item -LiteralPath (Join-Path $content 'content') -Destination $assets -Recurse
Copy-Item -LiteralPath (Join-Path $content 'export.json'),(Join-Path $content 'native-player.json') -Destination $assets
$r=Get-Content (Join-Path $runtime 'runtime.json') -Raw | ConvertFrom-Json
if($r.target -ne $Target -or $r.renderer -ne 'wgpu-native-instanced'){throw 'Native runtime target mismatch'}
foreach($file in $r.files){if($file.path -notmatch '^[a-zA-Z0-9_+.-]+\.so$'){throw 'Invalid native library filename'};$source=Join-Path $runtime $file.path;if((FileSha256 $source) -ne $file.sha256){throw 'Native library hash mismatch'};Copy-Item -LiteralPath $source -Destination $lib}
$label=[Security.SecurityElement]::Escape($AppName)
$xml=@"
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="$ApplicationId">
<uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/>
<uses-feature android:glEsVersion="0x00030000" android:required="true"/>
<application android:label="$label" android:hasCode="false" android:extractNativeLibs="true" android:theme="@android:style/Theme.Material.NoActionBar.Fullscreen" android:allowBackup="false">
<activity android:name="android.app.NativeActivity" android:exported="true" android:screenOrientation="landscape" android:configChanges="orientation|screenSize|keyboardHidden|uiMode|density">
<meta-data android:name="android.app.lib_name" android:value="unone_native_player"/>
<intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
</activity></application></manifest>
"@
$manifest=Join-Path $build 'AndroidManifest.xml';[IO.File]::WriteAllText($manifest,$xml,[Text.UTF8Encoding]::new($false))
$base=Join-Path $build 'base.apk';$aligned=Join-Path $build 'aligned.apk';$apk=Join-Path $content 'game.apk'
& $aapt link -o $base -I $androidJar --manifest $manifest --version-code 1 --version-name 0.1
if($LASTEXITCODE -ne 0){throw 'Native manifest link failed'}
& $jar uf $base -C $build assets -C $build lib
if($LASTEXITCODE -ne 0){throw 'Native APK assembly failed'}
& $align -f -p 4 $base $aligned
if($LASTEXITCODE -ne 0){throw 'Native APK alignment failed'}
$keydir=Join-Path $env:LOCALAPPDATA 'Unone/test-signing';New-Item -ItemType Directory -Force -Path $keydir | Out-Null;$key=Join-Path $keydir 'debug.keystore'
if(!(Test-Path -LiteralPath $key)){& $keytool -genkeypair -keystore $key -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Unone,C=TW';if($LASTEXITCODE -ne 0){throw 'Test signing key creation failed'}}
& $signer sign --ks $key --ks-pass pass:android --key-pass pass:android --out $apk $aligned
if($LASTEXITCODE -ne 0){throw 'Native APK signing failed'}
& $signer verify --verbose $apk
if($LASTEXITCODE -ne 0){throw 'Native APK verification failed'}
@{host='android-nativeactivity';renderer='wgpu-native-instanced';abi=$abi;signing='local-test-key';application_id=$ApplicationId;bytes=(Get-Item $apk).Length;sha256=(FileSha256 $apk);build_evidence=$build}|ConvertTo-Json|Set-Content (Join-Path $content 'apk.json') -Encoding utf8
