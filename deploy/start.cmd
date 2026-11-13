@echo off
rem Start de hal-TV en schrijft de uitvoer naar logs\server.log.
rem Wordt gestart door de geplande taak "VQY Hal-TV" (zie deploydeploy.ps1).
rem Stopt of crasht de webserver, dan start dit script hem na 10 seconden opnieuw.

cd /d "%~dp0.."
if not exist logs mkdir logs

:start
for %%F in (logs\server.log) do if %%~zF GTR 10485760 move /y logs\server.log logs\server.old.log >nul

rem Volledig pad naar server.js, zodat deploy.ps1 precies dit proces kan herkennen
node "%CD%\server.js" >> logs\server.log 2>&1
echo [%date% %time%] Webserver gestopt (code %ERRORLEVEL%), herstart over 10 seconden >> logs\server.log

ping -n 11 127.0.0.1 >nul
goto start
