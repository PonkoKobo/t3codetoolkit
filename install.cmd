@echo off
rem Installs T3CodeToolkit for the T3 Code desktop app on Windows.
rem   install.cmd                 install, and add "T3 Code + Toolkit" to the Start Menu
rem   install.cmd --uninstall     remove it again
rem Runs the installer with T3 Code's own binary as Node, so Node doesn't need to be installed.
setlocal EnableExtensions
title T3CodeToolkit installer
cd /d "%~dp0"

set "APP=%T3TK_APP%"
if not defined APP for %%P in (
  "%LOCALAPPDATA%\Programs\t3code\T3 Code (Beta).exe"
  "%LOCALAPPDATA%\Programs\t3code\T3 Code.exe"
  "%ProgramFiles%\t3code\T3 Code (Beta).exe"
  "%ProgramFiles%\t3code\T3 Code.exe"
) do if not defined APP if exist %%P set "APP=%%~P"

if not exist "dist\t3tk-core.js" (
  where npm >nul 2>nul && (call npm install --no-audit --no-fund && call npm run build)
)

if defined APP (
  set "ELECTRON_RUN_AS_NODE=1"
  "%APP%" desktop\install.mjs --app "%APP%" %*
) else (
  where node >nul 2>nul || (echo T3 Code was not found. Install it, or set T3TK_APP to the T3 Code executable. & goto done)
  node desktop\install.mjs %*
)

:done
if not defined T3TK_NO_PAUSE pause
