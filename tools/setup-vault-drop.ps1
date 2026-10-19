[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidatePattern('^[A-Za-z]$')]
    [string]$DriveLetter = 'W',

    [string]$DropRootName = 'BraidLens_Drop',

    [string[]]$Members = @(
        'Gemini',
        'Perplexity',
        'Qwen'
    ),

    [switch]$OpenWhenDone
)

$ErrorActionPreference = 'Stop'

$driveRoot = "$($DriveLetter.ToUpperInvariant()):\"

if (-not (Test-Path -LiteralPath $driveRoot)) {
    throw "Drive $driveRoot is not available. Mount the VeraCrypt volume first, then rerun this script."
}

$dropRoot = Join-Path -Path $driveRoot -ChildPath $DropRootName

$paths = @(
    $dropRoot,
    (Join-Path -Path $driveRoot -ChildPath 'Reviewed'),
    (Join-Path -Path $driveRoot -ChildPath 'Rejected')
)

foreach ($member in $Members) {
    if ([string]::IsNullOrWhiteSpace($member)) {
        continue
    }

    $paths += Join-Path -Path $dropRoot -ChildPath $member.Trim()
}

foreach ($path in $paths) {
    if ($PSCmdlet.ShouldProcess($path, 'Create directory if missing')) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
}

$manifestPath = Join-Path -Path $driveRoot -ChildPath 'BRAIDLENS_VAULT_README.txt'
$manifest = @"
BraidLens Vault Drop

Purpose:
  Local VeraCrypt-backed drop zone for browser-based AI sessions.

Folder map:
  $DropRootName\
    Gemini\
    Perplexity\
    Qwen\
  Reviewed\
  Rejected\

Use:
  Bind BraidLens to $dropRoot after mounting this VeraCrypt volume.
  Browser sessions may write drafts into their drop folders.
  Timothy reviews and moves accepted work.

Note:
  This script creates folders only. It does not apply write-only NTFS permissions.
"@

if ($PSCmdlet.ShouldProcess($manifestPath, 'Write vault README')) {
    Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding UTF8
}

Write-Host "BraidLens vault folders are ready at $driveRoot"
Write-Host "Bind BraidLens to: $dropRoot"

if ($OpenWhenDone) {
    Start-Process -FilePath explorer.exe -ArgumentList $driveRoot
}
