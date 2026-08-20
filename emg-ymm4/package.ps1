<#
.SYNOPSIS
    EMG 立ち絵プラグインの配布用 ZIP を作る。

.DESCRIPTION
    Release ビルドを行い、YMM4 の user\plugin\ にそのまま展開できる形の ZIP を
    dist\ に出力する。ZIP の中身は次の構成:

        EmgTachiePlugin\
            EmgTachiePlugin.dll
            Emg.Core.dll
            README.md
            LICENSE.md

    ビルドには Directory.Build.props（Directory.Build.props.sample をコピーして
    YMM4DirPath を設定したもの）が必要。YMM4 の DLL を参照するため。

.EXAMPLE
    .\package.ps1
    .\package.ps1 -Configuration Debug
#>
[CmdletBinding()]
param(
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$repoRoot = Split-Path $root -Parent

if (-not (Test-Path (Join-Path $root 'Directory.Build.props'))) {
    throw "Directory.Build.props がありません。Directory.Build.props.sample をコピーし、YMM4DirPath を設定してください。"
}

$dotnet = if (Get-Command dotnet -ErrorAction SilentlyContinue) { 'dotnet' } else { "$env:ProgramFiles\dotnet\dotnet.exe" }
if (-not (Test-Path $dotnet) -and $dotnet -ne 'dotnet') { throw "dotnet が見つかりません。" }

Write-Host "ビルド中 ($Configuration)..." -ForegroundColor Cyan
# SkipYmm4Deploy: YMM4 起動中でも失敗しないよう、user\plugin\ への自動コピーは行わない。
& $dotnet build (Join-Path $root 'emg-ymm4.slnx') -c $Configuration -v q --nologo -p:SkipYmm4Deploy=true
if ($LASTEXITCODE -ne 0) { throw "ビルドに失敗しました。" }

# バージョンは EmgTachiePlugin.dll から読む（csproj の <Version> が唯一の情報源）。
$pluginDir = Join-Path $root "EmgTachiePlugin\bin\$Configuration\net10.0-windows10.0.19041.0"
$pluginDll = Join-Path $pluginDir 'EmgTachiePlugin.dll'
if (-not (Test-Path $pluginDll)) { throw "ビルド成果物が見つかりません: $pluginDll" }
$version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($pluginDll).ProductVersion -replace '\+.*$', ''

$distRoot = Join-Path $root 'dist'
$stage = Join-Path $distRoot "stage\EmgTachiePlugin"
if (Test-Path (Join-Path $distRoot 'stage')) { Remove-Item (Join-Path $distRoot 'stage') -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

Copy-Item $pluginDll $stage
Copy-Item (Join-Path $pluginDir 'Emg.Core.dll') $stage
Copy-Item (Join-Path $root 'package\README.md') $stage
Copy-Item (Join-Path $repoRoot 'LICENSE.md') $stage

$zipPath = Join-Path $distRoot "EmgTachiePlugin-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $stage -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item (Join-Path $distRoot 'stage') -Recurse -Force

Write-Host ""
Write-Host "作成しました: $zipPath" -ForegroundColor Green
Get-ChildItem $zipPath | Select-Object Name, @{n='Size';e={"{0:N0} B" -f $_.Length}} | Format-Table -AutoSize
Write-Host "中身:"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$zip.Entries | ForEach-Object { "  {0,-40} {1,10:N0} B" -f $_.FullName, $_.Length }
$zip.Dispose()
