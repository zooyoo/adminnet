param([string]$NodePath = 'node')

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$origin = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$plan = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'cleanup47-plan.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($plan.primaryDeletionApplied -or $plan.proposal -ne 47 -or $plan.baseCommit -notmatch '^[a-f0-9]{40}$') { throw 'Invalid isolated cleanup plan.' }
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$candidateRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot ('adminnet-cleanup47-' + [guid]::NewGuid().ToString('N'))))
if ([IO.Path]::GetDirectoryName($candidateRoot) -ne $tempRoot -or (Test-Path -LiteralPath $candidateRoot)) { throw 'Candidate root must be a new direct temporary child.' }
& git -C $origin cat-file -e ($plan.baseCommit + '^{commit}')
if ($LASTEXITCODE -ne 0) { throw 'Cleanup base commit missing.' }
& git -C $origin worktree add --detach $candidateRoot $plan.baseCommit
if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated cleanup worktree.' }
$control = [ordered]@{ schema = 1; kind = 'proposal47-isolated-review'; origin = $origin; baseCommit = $plan.baseCommit; recoveryRef = $plan.recoveryRef; root = $candidateRoot; createdAt = [datetime]::UtcNow.ToString('o'); primaryDeletionApplied = $false }
$control | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $candidateRoot '.adminnet-cleanup47-owner.json') -Encoding UTF8
# 继承当前用户指引；副本不恢复已撤销的旧门禁。
Copy-Item -LiteralPath (Join-Path $origin 'AGENTS.md') -Destination (Join-Path $candidateRoot 'AGENTS.md')
$control | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'cleanup47-control.tmp.json') -Encoding UTF8
& $NodePath (Join-Path $PSScriptRoot 'prepare-cleanup47-worktree.mjs') $candidateRoot
if ($LASTEXITCODE -ne 0) { throw 'Isolated fixed-manifest preparation failed; preserve the owned worktree for diagnosis.' }
$control | ConvertTo-Json
