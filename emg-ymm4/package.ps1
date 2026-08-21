<#
.SYNOPSIS
    EMG 立ち絵プラグインの配布用 .ymme を作る。

.DESCRIPTION
    Release ビルドを行い、YMM4 公式のプラグインパッケージ（.ymme）を dist\ に出力する。
    .ymme は拡張子を変えただけの ZIP で、ユーザーはダブルクリックでインストールできる。
    中身は次の構成:

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

# ZipFileExtensions は System.IO.Compression.FileSystem、
# ZipArchive / ZipArchiveMode は System.IO.Compression にある（別アセンブリ）。
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

# 出力は .ymme（YMM4 公式のプラグインパッケージ形式）。中身は単なる ZIP で、
# 拡張子が OS に関連付けられているためユーザーはダブルクリックでインストールできる。
# インストーラー（Resources\bin\Installer\YukkuriMovieMaker.Plugin.Installer.exe）は
#   - ZIP 内の共通ルートフォルダ名をプラグイン名として user\plugin\<名前>\ へ展開する
#     （共通ルートは剥がされるので二重フォルダにならない）
#   - readme / 利用規約（.txt/.md）を見つけるとインストール画面に表示する
# ため、stage は "EmgTachiePlugin\" を共通ルートに持つ形にしてある。
# Compress-Archive は拡張子 .zip を強制するので使えない。
# ZipFile.CreateFromDirectory も使えない: .NET Framework 上ではエントリ名の区切りが
# Path.DirectorySeparatorChar（Windows では '\'）になり、ZIP 仕様の '/' にならない。
# インストーラーは FullName を '/' で split して共通ルートを求めるため、'\' 区切りだと
# 共通ルートを検出できず、プラグイン名がファイル名（EmgTachiePlugin-0.1.0）に化ける。
# エントリを1件ずつ '/' 区切りの名前で追加する。
$ymmePath = Join-Path $distRoot "EmgTachiePlugin-$version.ymme"
if (Test-Path $ymmePath) { Remove-Item $ymmePath -Force }
$stageRoot = Join-Path $distRoot 'stage'
$fileStream = [System.IO.File]::Open($ymmePath, [System.IO.FileMode]::Create)
try {
    $archive = New-Object System.IO.Compression.ZipArchive($fileStream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($f in Get-ChildItem $stageRoot -Recurse -File | Sort-Object FullName) {
            $rel = $f.FullName.Substring($stageRoot.Length).TrimStart('\', '/').Replace('\', '/')
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
        }
    } finally { $archive.Dispose() }
} finally { $fileStream.Dispose() }
Remove-Item $stageRoot -Recurse -Force

Write-Host ""
Write-Host "作成しました: $ymmePath" -ForegroundColor Green
Get-ChildItem $ymmePath | Select-Object Name, @{n='Size';e={"{0:N0} B" -f $_.Length}} | Format-Table -AutoSize
Write-Host "中身:"
$zip = [System.IO.Compression.ZipFile]::OpenRead($ymmePath)
$zip.Entries | ForEach-Object { "  {0,-40} {1,10:N0} B" -f $_.FullName, $_.Length }
$zip.Dispose()
