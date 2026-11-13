<#
    Zet een nieuwe versie van de hal-TV live. Richt bij de eerste keer ook alles zelf in.

    Wordt automatisch uitgevoerd door GitHub Actions (.github/workflows/deploy.yml) op de
    self-hosted runner op de dashboardserver (draait als SYSTEM). Kan ook met de hand,
    in PowerShell als administrator:
        powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1

    Werkt in Windows PowerShell 5.1.
#>
param(
    # Map met de nieuwe versie (de git-checkout)
    [string]$Source = (Split-Path -Parent $PSScriptRoot),
    # Waar de hal-TV draait. data\ (slides, foto's, wachtwoord) en .env blijven altijd staan.
    [string]$Target = 'C:\HallTV',
    [string]$TaskName = 'VQY Hal-TV',
    [int]$DefaultPort = 8800,
    # Netwerknaam (DNS-alias) waarmee iedereen de hal-TV opent, zie README "Netwerknaam hall-tv"
    [string]$Alias = 'hall-tv'
)

$ErrorActionPreference = 'Stop'
function Step($text) { Write-Host "==> $text" }

# Poort: uit .env als die er is, anders de standaard
$envFile = Join-Path $Target '.env'
$port = $DefaultPort
if (Test-Path $envFile) {
    $portLine = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($portLine) { $port = [int]$portLine.Matches[0].Groups[1].Value }
}

# 1. Bestanden kopiëren. data, logs, node_modules en .env worden niet aangeraakt
#    (uitgesloten items worden door /MIR ook niet verwijderd).
Step "Bestanden kopiëren naar $Target"
New-Item -ItemType Directory -Force -Path $Target | Out-Null
robocopy $Source $Target /MIR /XD node_modules logs data /XF .env *.log /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Kopiëren mislukt (robocopy code $LASTEXITCODE)" }

# 2. Eerste keer: geplande taak aanmaken (start bij opstarten, draait als SYSTEM)
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
    Step "Geplande taak '$TaskName' aanmaken"
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Target\deploy\start.cmd`"" -WorkingDirectory $Target
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}

# 3. Eerste keer: poort openzetten in de Windows-firewall (alleen domein- en privénetwerk)
#    Bestaat de regel al met een andere poort (poort gewijzigd), dan wordt hij bijgewerkt.
$rule = Get-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue
if (-not $rule) {
    Step "Firewallregel '$TaskName' aanmaken voor TCP $port"
    New-NetFirewallRule -DisplayName $TaskName -Direction Inbound -Protocol TCP -LocalPort $port `
        -Action Allow -Profile Domain, Private | Out-Null
} elseif ((($rule | Get-NetFirewallPortFilter).LocalPort) -ne "$port") {
    Step "Firewallregel '$TaskName' bijwerken naar TCP $port"
    $rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -LocalPort $port
}

# 4. Webserver stoppen
Step "Webserver stoppen"
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$serverJs = Join-Path $Target 'server.js'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($serverJs) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# 5. Dependencies alleen opnieuw installeren als package-lock.json veranderd is
$lock = Join-Path $Target 'package-lock.json'
$hashFile = Join-Path $Target 'node_modules\.deploy-lock-hash'
$newHash = (Get-FileHash $lock -Algorithm SHA256).Hash
$oldHash = if (Test-Path $hashFile) { Get-Content $hashFile -Raw } else { '' }
if ($newHash -ne $oldHash.Trim()) {
    Step "Dependencies installeren (npm ci)"
    Push-Location $Target
    try {
        & npm ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci mislukt (code $LASTEXITCODE)" }
    } finally { Pop-Location }
    Set-Content -Path $hashFile -Value $newHash -NoNewline
} else {
    Step "Dependencies ongewijzigd, npm ci overgeslagen"
}

# 6. Webserver starten en controleren
Step "Webserver starten"
Start-ScheduledTask -TaskName $TaskName

Step "Controleren of http://127.0.0.1:$port/ reageert"
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$port/api/content" -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
}
if (-not $ok) {
    $log = Join-Path $Target 'logs\server.log'
    if (Test-Path $log) {
        Write-Host '--- laatste regels van logs\server.log ---'
        Get-Content $log -Tail 30 | ForEach-Object { Write-Host $_ }
    }
    throw "Hal-TV reageert niet na 30 seconden."
}

# 7. Wijst de netwerknaam naar deze server? Alleen een waarschuwing, de deploy zelf is gelukt.
$localIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddress })
$aliasIps = @()
try { $aliasIps = @([System.Net.Dns]::GetHostAddresses($Alias) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | ForEach-Object { $_.ToString() }) } catch { }
if (-not $aliasIps) {
    Write-Warning "De naam '$Alias' bestaat nog niet in DNS. Maak een CNAME '$Alias' naar $($env:COMPUTERNAME) aan (zie README). Tot die tijd: http://$($env:COMPUTERNAME):$port/"
} elseif (-not ($aliasIps | Where-Object { $localIps -contains $_ })) {
    Write-Warning "De naam '$Alias' wijst naar $($aliasIps -join ', '), niet naar deze server ($($localIps -join ', ')). Pas het DNS-record aan."
} else {
    Step "Netwerknaam '$Alias' wijst naar deze server"
}

Step "Klaar: hal-TV draait op poort $port (TV: http://${Alias}:$port/  beheer: http://${Alias}:$port/admin)"
# Robocopy geeft 1 bij gekopieerde bestanden; expliciet "gelukt" teruggeven
exit 0
