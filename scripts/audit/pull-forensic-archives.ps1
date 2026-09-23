[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Remote,

    [Parameter(Position = 1)]
    [string]$ForensicRemoteDir = "/opt/ascendance-social/backend/forensic/archives",

    [Parameter(Position = 2)]
    [string]$LocalDir = (Join-Path $HOME "AscendanceForensicArchives"),

    [switch]$DeleteRemoteAfterPull
)

$ErrorActionPreference = "Stop"
$null = New-Item -ItemType Directory -Force -Path $LocalDir

$remoteListCommand = "find '$ForensicRemoteDir' -type f -name 'forensic-*.v*.json.gz.enc' -exec sha256sum {} \;"
$remoteEntries = & ssh $Remote $remoteListCommand
if ($LASTEXITCODE -ne 0) {
    throw "Failed to list remote forensic archives."
}

foreach ($entry in $remoteEntries) {
    if ($entry -notmatch '^(?<hash>[0-9a-fA-F]{64})\s+(?<path>.+)$') {
        continue
    }

    $expectedHash = $Matches.hash.ToLowerInvariant()
    $remotePath = $Matches.path
    $remoteRoot = $ForensicRemoteDir.TrimEnd('/')
    if (-not $remotePath.StartsWith("$remoteRoot/", [System.StringComparison]::Ordinal)) {
        throw "Remote forensic archive escaped the configured directory: $remotePath"
    }

    $relativePath = $remotePath.Substring($remoteRoot.Length + 1)
    $localPath = Join-Path $LocalDir ($relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    $localParent = Split-Path -Parent $localPath
    $null = New-Item -ItemType Directory -Force -Path $localParent

    $alreadyVerified = $false
    if (Test-Path -LiteralPath $localPath -PathType Leaf) {
        $localHash = (Get-FileHash -LiteralPath $localPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $alreadyVerified = $localHash -eq $expectedHash
    }

    if ($alreadyVerified) {
        Write-Host "Already verified forensic archive: $relativePath"
    }
    else {
        & scp "${Remote}:$remotePath" $localPath
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to copy forensic archive: $remotePath"
        }

        $localHash = (Get-FileHash -LiteralPath $localPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($localHash -ne $expectedHash) {
            throw "Forensic archive checksum mismatch: $relativePath"
        }
        Write-Host "Verified forensic archive: $relativePath"
    }

    if ($DeleteRemoteAfterPull) {
        if ($remotePath.Contains("'")) {
            throw "Cannot safely delete a remote path containing a single quote: $remotePath"
        }
        & ssh $Remote "rm -f -- '$remotePath' '${remotePath}.sha256'"
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to delete remote forensic archive: $remotePath"
        }
        Write-Host "Deleted remote forensic archive after verified pull: $remotePath"
    }
}
