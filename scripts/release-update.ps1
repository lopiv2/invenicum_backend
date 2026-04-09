param(
  [Parameter(Mandatory=$true)][string]$Version,
  [switch]$SkipBuild,
  [string]$CommitMessage = "Update tag $Version to latest main"
)

Write-Host "[release-update] Updating tag: $Version -> origin/main"

if (-not (git rev-parse --is-inside-work-tree 2>$null)) {
  Write-Error "Not inside a git repository. Run this script from the repository root."
  exit 1
}

Write-Host "Fetching origin/main..."
git fetch origin main
if ($LASTEXITCODE -ne 0) { Write-Error "git fetch failed"; exit 1 }

$sha = git rev-parse origin/main
if ($LASTEXITCODE -ne 0 -or -not $sha) { Write-Error "Could not determine origin/main SHA"; exit 1 }

Write-Host "Pointing tag $Version to $sha (force local tag and push)"
git tag -f $Version $sha
if ($LASTEXITCODE -ne 0) { Write-Error "git tag -f failed"; exit 1 }

git push --force origin refs/tags/$Version
if ($LASTEXITCODE -ne 0) { Write-Error "git push --force tag failed"; exit 1 }

Write-Host "Tag $Version updated to $sha and pushed. The workflow will run on tag push."
if ($SkipBuild) { Write-Host "Note: pass skip_build config when needed via workflow inputs." }
