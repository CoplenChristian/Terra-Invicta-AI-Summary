<#
.SYNOPSIS
    Starts the Terra Invicta Strategic Intelligence Dashboard Web Application.

.DESCRIPTION
    Launches the Node.js dashboard server and opens http://localhost:3000 in your browser.
#>

[CmdletBinding()]
param(
    [int]$Port = 3000
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $scriptPath

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   TERRA INVICTA STRATEGIC INTELLIGENCE & COMMAND         " -ForegroundColor Yellow
Write-Host "   Starting server on http://localhost:$Port ...          " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

$env:PORT = $Port

Start-Process "http://localhost:$Port"
node server/index.js
