$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.toolcache'))
New-Item -ItemType Directory -Force $root | Out-Null
$archive = Join-Path $root 'binaryen-version_131-x86_64-windows.tar.gz'
Invoke-WebRequest 'https://github.com/WebAssembly/binaryen/releases/download/version_131/binaryen-version_131-x86_64-windows.tar.gz' -OutFile $archive
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '2f4edac1703a2f695254d6ff52ede03481e67db1f094915763d863158c17d9bc') { throw 'Binaryen checksum mismatch' }
tar -xzf $archive -C $root binaryen-version_131/bin binaryen-version_131/LICENSE
if ($LASTEXITCODE -ne 0) { throw 'Binaryen extraction failed' }
Write-Output (Join-Path $root 'binaryen-version_131')
