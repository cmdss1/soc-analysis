$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    $nodeDir = "${env:ProgramFiles}\nodejs"
    if (Test-Path "$nodeDir\npm.cmd") {
        $env:Path = "$nodeDir;$env:Path"
    }
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm not found. Install Node.js LTS from https://nodejs.org then reopen PowerShell."
}

if (-not (Test-Path "node_modules")) {
    npm install
}

if (-not (Test-Path ".env.local")) {
    Set-Content -Path ".env.local" -Value "NEXT_PUBLIC_API_BASE=http://localhost:8000`n"
}

npm run dev -- --hostname 127.0.0.1 --port 3000
