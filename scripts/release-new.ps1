param(
  [Parameter(Mandatory=$true)][string]$Version,
  [switch]$SkipBuild,
  [string]$CommitMessage = "Release $Version"
)

Write-Host "[release-new] Releasing new version: $Version"

if (-not (git rev-parse --is-inside-work-tree 2>$null)) {
  Write-Error "Not inside a git repository. Run this script from the repository root."
  exit 1
}

$changes = git status --porcelain
if ($changes) {
  Write-Host "Staging and committing changes..."
  git add -A
  git commit -m "$CommitMessage"
  if ($LASTEXITCODE -ne 0) { Write-Error "git commit failed"; exit 1 }
  git push origin main
  if ($LASTEXITCODE -ne 0) { Write-Error "git push failed"; exit 1 }
} else {
  Write-Host "No changes to commit. Ensuring local main is up to date..."
  git fetch origin main
}

Write-Host "Creating annotated tag $Version and pushing to origin..."
git tag -a $Version -m "$Version"
if ($LASTEXITCODE -ne 0) { Write-Error "git tag failed"; exit 1 }
git push origin $Version
if ($LASTEXITCODE -ne 0) { Write-Error "git push tag failed"; exit 1 }

Write-Host "Tag pushed. The GitHub Action will run on tag push and build the image."
if ($SkipBuild) { Write-Host "Note: You passed -SkipBuild; add -f skip_build=true to workflow dispatch if using that path." }
