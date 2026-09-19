param(
 [ValidateSet('windows','android-arm64','android-x86_64')][string]$Target='windows',
 [Parameter(Mandatory=$true)][string]$OutputRoot,
 [switch]$LuauCodegen
)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=[IO.Path]::GetFullPath($OutputRoot)
if(Test-Path -LiteralPath $output){throw 'Choose a new runtime directory'}
$env:CARGO_INCREMENTAL='0'
$buildFeatures=@();if($LuauCodegen){$buildFeatures=@('--features','native-codegen')}
$manifest=Join-Path $repo 'crates/unone-native-player/Cargo.toml'
$windows=Join-Path $repo 'target/native-player/release/unone-native-player.exe'
if($Target -eq 'windows'){
 & cargo build --manifest-path $manifest --release --target-dir (Join-Path $repo 'target/native-player') -j 2 @buildFeatures
 if($LASTEXITCODE -ne 0){throw 'Native player build failed'}
 $source=$windows;$name='unone-native-player.exe'
}else{
 if(!(Test-Path -LiteralPath $windows)){throw 'Build Windows runtime first to generate the shared capability descriptor'}
 $triple=if($Target -eq 'android-arm64'){'aarch64-linux-android'}else{'x86_64-linux-android'}
 $sdk=$env:ANDROID_HOME;if(!$sdk){$sdk=$env:ANDROID_SDK_ROOT};if(!$sdk){throw 'ANDROID_HOME required'}
 $ndk=Get-ChildItem (Join-Path $sdk 'ndk') -Directory | Sort-Object Name -Descending | Select-Object -First 1
 $llvm=Join-Path $ndk.FullName 'toolchains/llvm/prebuilt/windows-x86_64/bin'
 $key=$triple.Replace('-','_');$upper=$key.ToUpperInvariant()
 [Environment]::SetEnvironmentVariable("CC_$key",(Join-Path $llvm "$($triple)26-clang.cmd"),'Process')
 [Environment]::SetEnvironmentVariable("CXX_$key",(Join-Path $llvm "$($triple)26-clang++.cmd"),'Process')
 [Environment]::SetEnvironmentVariable("AR_$key",(Join-Path $llvm 'llvm-ar.exe'),'Process')
 [Environment]::SetEnvironmentVariable("CARGO_TARGET_$($upper)_LINKER",(Join-Path $llvm "$($triple)26-clang.cmd"),'Process')
 $build=Join-Path $repo "target/native-player-$Target"
 & cargo build --manifest-path $manifest --release --lib --target $triple --target-dir $build -j 2 @buildFeatures
 if($LASTEXITCODE -ne 0){throw 'Android native player build failed'}
 $source=Join-Path $build "$triple/release/libunone_native_player.so";$name='libunone_native_player.so'
}
$descriptor=(& $windows --describe | ConvertFrom-Json)
if($LASTEXITCODE -ne 0){throw 'Native capability query failed'}
if($null -eq $descriptor.readiness){throw 'Native capability query missing readiness contract'}
New-Item -ItemType Directory -Path $output | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $output $name)
$files=@(@{path=$name;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()})
if($Target -ne 'windows'){
 $cpp=Join-Path $ndk.FullName "toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/$triple/libc++_shared.so"
 Copy-Item -LiteralPath $cpp -Destination (Join-Path $output 'libc++_shared.so')
 $files+=@{path='libc++_shared.so';sha256=(Get-FileHash -LiteralPath $cpp -Algorithm SHA256).Hash.ToLowerInvariant()}
}
$report=@{version=1;target=$Target;profile='release';dev_tools=$false;preview_tools=$false;renderer=$descriptor.renderer;readiness=$descriptor.readiness;compiled_systems=$descriptor.compiled_systems;decoders=$descriptor.decoders;presentation=$descriptor.presentation;ui=$descriptor.ui;files=$files;source_commit=(git -C $repo rev-parse HEAD);native_codegen_compiled=[bool]$LuauCodegen;source_dirty=[bool](git -C $repo status --porcelain)}
[IO.File]::WriteAllText((Join-Path $output 'runtime.json'),($report|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$report|ConvertTo-Json -Depth 6
