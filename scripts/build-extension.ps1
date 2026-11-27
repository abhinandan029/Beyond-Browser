[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$frontendDir = Join-Path $repoRoot 'frontend'
$distDir = Join-Path $frontendDir 'dist'
$extensionDir = Join-Path $repoRoot 'extension'
$panelDir = Join-Path $extensionDir 'sidepanel'
$assetDir = Join-Path $panelDir 'assets'
$manifestPath = Join-Path $extensionDir 'manifest.json'

function Assert-LocalAssetReferences {
    param(
        [Parameter(Mandatory)][string]$HtmlPath,
        [Parameter(Mandatory)][string]$RootDirectory
    )

    $html = Get-Content -LiteralPath $HtmlPath -Raw
    if ($html -match '(?i)https?://(?:localhost|127\.0\.0\.1):5173') {
        throw "Generated HTML references the Vite development server: $HtmlPath"
    }

    $references = [System.Collections.Generic.List[string]]::new()
    foreach ($match in [regex]::Matches($html, '(?is)<script\b[^>]*\bsrc=["'']([^"'']+)["'']')) {
        $references.Add($match.Groups[1].Value)
    }
    foreach ($match in [regex]::Matches($html, '(?is)<link\b(?=[^>]*\brel=["''][^"'']*stylesheet[^"'']*["''])[^>]*\bhref=["'']([^"'']+)["'']')) {
        $references.Add($match.Groups[1].Value)
    }

    if ($references.Count -eq 0) {
        throw "No JavaScript or stylesheet assets were found in $HtmlPath"
    }

    $rootFull = [System.IO.Path]::GetFullPath($RootDirectory).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    foreach ($reference in $references) {
        if ($reference -match '^(?:/|\\|[a-z][a-z0-9+.-]*:|//)' -or $reference.Contains('://')) {
            throw "Asset path must be relative for Chrome extension URLs. Found '$reference' in $HtmlPath"
        }
        $decoded = [System.Uri]::UnescapeDataString(($reference -split '[?#]', 2)[0])
        $assetFull = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $HtmlPath) $decoded))
        if (-not $assetFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Asset reference escapes the packaged side panel directory: '$reference'"
        }
        if (-not (Test-Path -LiteralPath $assetFull -PathType Leaf)) {
            throw "Referenced asset is missing: '$reference' (resolved to '$assetFull')"
        }
    }
}

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Extension manifest is missing: $manifestPath"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$expectedPanelPath = 'sidepanel/index.html'
if ($manifest.side_panel.default_path -ne $expectedPanelPath) {
    throw "manifest.json side_panel.default_path must be '$expectedPanelPath'; found '$($manifest.side_panel.default_path)'"
}
foreach ($required in @($manifest.background.service_worker, $manifest.side_panel.default_path, 'content/content.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $extensionDir $required) -PathType Leaf) -and $required -ne $manifest.side_panel.default_path) {
        throw "Required extension file is missing: $required"
    }
}

Push-Location $frontendDir
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend production build failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

$distHtml = Join-Path $distDir 'index.html'
if (-not (Test-Path -LiteralPath $distHtml -PathType Leaf)) {
    throw "Vite build did not produce $distHtml"
}
if (-not (Test-Path -LiteralPath $assetDir -PathType Container)) {
    # Validate this exact generated destination before creating it.
    $expectedAssetDir = [System.IO.Path]::GetFullPath((Join-Path $panelDir 'assets'))
    if (-not $expectedAssetDir.StartsWith([System.IO.Path]::GetFullPath($panelDir), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to create an asset directory outside the side panel: $expectedAssetDir"
    }
}

$resolvedPanel = [System.IO.Path]::GetFullPath($panelDir).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$resolvedAssets = [System.IO.Path]::GetFullPath($assetDir)
if (-not $resolvedAssets.StartsWith($resolvedPanel, [System.StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetFileName($resolvedAssets) -ne 'assets') {
    throw "Refusing to clean an unexpected generated asset path: $resolvedAssets"
}

# Vite's hashed bundles are wholly contained in this generated assets directory.
# Clear only that directory; manifest, service worker, content script, and other
# extension files are outside this path and remain untouched.
if (Test-Path -LiteralPath $assetDir) {
    Remove-Item -LiteralPath $assetDir -Recurse -Force
}
New-Item -ItemType Directory -Path $panelDir -Force | Out-Null
Copy-Item -LiteralPath $distHtml -Destination (Join-Path $panelDir 'index.html') -Force
$distAssets = Join-Path $distDir 'assets'
if (Test-Path -LiteralPath $distAssets -PathType Container) {
    Copy-Item -LiteralPath $distAssets -Destination $panelDir -Recurse -Force
}
# Copy any additional Vite output (for example public files) while keeping the
# generated asset directory freshly replaced above.
Get-ChildItem -LiteralPath $distDir -Force | Where-Object { $_.Name -notin @('index.html', 'assets') } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $panelDir -Recurse -Force
}

$packagedHtml = Join-Path $panelDir 'index.html'
if (-not (Test-Path -LiteralPath $packagedHtml -PathType Leaf)) {
    throw "Packaged side-panel HTML is missing: $packagedHtml"
}
Assert-LocalAssetReferences -HtmlPath $distHtml -RootDirectory $distDir
Assert-LocalAssetReferences -HtmlPath $packagedHtml -RootDirectory $panelDir

# Ensure the Chrome entry points and preserved extension scripts still exist.
foreach ($requiredPath in @('manifest.json', $manifest.background.service_worker, 'content/content.js', $manifest.side_panel.default_path)) {
    if (-not (Test-Path -LiteralPath (Join-Path $extensionDir $requiredPath) -PathType Leaf)) {
        throw "Required extension file is missing after packaging: $requiredPath"
    }
}

Write-Host "Packaged Chrome side panel: $packagedHtml"
Write-Host 'Validated relative JS/CSS references and confirmed each referenced asset exists.'
