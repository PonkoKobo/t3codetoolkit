@echo off
rem Persistently turns T3 Code product analytics off (or back on) for this Windows user.
rem The desktop app's backend reads T3CODE_TELEMETRY_ENABLED; quit and restart T3 Code afterwards.
rem Uses .NET so the change is broadcast to Explorer, which is what new app launches inherit from.
title T3CodeToolkit - telemetry setting
if /I "%~1"=="on" (
  powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('T3CODE_TELEMETRY_ENABLED', $null, 'User')" || goto failed
  echo Telemetry setting removed. Quit and restart T3 Code to go back to its default.
  exit /b 0
)
if not "%~1"=="" if /I not "%~1"=="off" (
  echo Usage: %~nx0 [off^|on]
  exit /b 2
)
powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('T3CODE_TELEMETRY_ENABLED', 'false', 'User')" || goto failed
echo T3CODE_TELEMETRY_ENABLED=false set for your user. Quit and restart T3 Code.
exit /b 0
:failed
echo Couldn't change the setting.
exit /b 1
