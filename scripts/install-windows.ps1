$ErrorActionPreference = "Stop"
$KitRoot = Split-Path -Parent $PSScriptRoot

Push-Location $KitRoot
try {
  & node scripts/blog-kit.mjs doctor
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
