@echo off
rem Herstart de VQY Hal-TV, bijv. na een wijziging in C:\HallTV\.env of als de TV niets meer laat zien.
rem Dubbelklikken is genoeg: vraagt zelf om administratorrechten.
rem Tip: maak een snelkoppeling naar C:\HallTV\deploy\restart-hall-tv.cmd op het bureaublad.

title VQY Hal-TV herstarten

rem Administratorrechten nodig (de webserver draait als SYSTEM)
net session >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo Webserver stoppen...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*C:\HallTV\server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"

rem Draait de taak niet (meer)? Dan opnieuw starten. Anders start start.cmd de webserver zelf binnen 10 seconden.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-ScheduledTask -TaskName 'VQY Hal-TV' -ErrorAction SilentlyContinue; if (-not $t) { Write-Host 'Geplande taak VQY Hal-TV bestaat niet. Draai eerst een deploy via GitHub Actions.' -ForegroundColor Red; exit 1 }; if ($t.State -ne 'Running') { Start-ScheduledTask -TaskName 'VQY Hal-TV' }"
if errorlevel 1 goto end

echo Wachten tot de hal-TV weer reageert (max. 40 seconden)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = 5510; if (Test-Path 'C:\HallTV\.env') { $l = Select-String -Path 'C:\HallTV\.env' -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1; if ($l) { $port = [int]$l.Matches[0].Groups[1].Value } }; for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Seconds 1; try { $r = Invoke-WebRequest ('http://127.0.0.1:' + $port + '/api/content') -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { Write-Host ('Klaar: hal-TV draait weer op poort ' + $port) -ForegroundColor Green; exit 0 } } catch { } }; Write-Host 'Hal-TV reageert niet. Laatste regels van de log:' -ForegroundColor Red; Get-Content 'C:\HallTV\logs\server.log' -Tail 20"

:end
echo.
pause
