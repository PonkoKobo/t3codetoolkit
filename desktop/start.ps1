# Starts T3 Code with T3CodeToolkit. The installer's Start Menu shortcut runs this hidden.
# It runs the launcher with T3 Code's own binary as Node, so Node doesn't need to be installed.
$dir = $PSScriptRoot
$runtime = "$(Get-Content -LiteralPath (Join-Path $dir 'runtime.txt') -Raw -ErrorAction SilentlyContinue)".Trim()
if (-not $runtime -or -not (Test-Path -LiteralPath $runtime)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  $runtime = if ($node) { $node.Source } else { $null }
}

function Show-Message($text) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($text, 'T3CodeToolkit')
}

if (-not $runtime) {
  Show-Message 'T3 Code was not found. Reinstall T3 Code, then run the T3CodeToolkit installer again.'
  exit 1
}

$env:ELECTRON_RUN_AS_NODE = '1'
& $runtime (Join-Path $dir 'launch.mjs') @args 2>&1 | Out-File -FilePath (Join-Path $dir 'launcher-output.log') -Append -Encoding utf8
$code = $LASTEXITCODE
if ($code -eq 0) { exit 0 }

$config = Get-Content -LiteralPath (Join-Path $dir 'config.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
# Electron on Windows can return 130 when another instance accepts the launch.
# Only treat it as a handoff if the matching app still has a window in our session.
$existingWindow = $false
if ($code -eq 130 -and $config.app) {
  $appName = [IO.Path]::GetFileNameWithoutExtension($config.app)
  $session = (Get-Process -Id $PID).SessionId
  $existingWindow = Get-Process -Name $appName -ErrorAction SilentlyContinue | Where-Object {
    $_.SessionId -eq $session -and $_.MainWindowHandle -ne 0 -and $_.Path -eq $config.app
  } | Select-Object -First 1
}
if ($code -eq 3 -or $existingWindow) {
  Show-Message 'T3 Code is already open. Check its title bar for Toolkit. If the button is missing, you can keep working with Toolkit disabled. To enable it, quit T3 Code and reopen it from "T3 Code + Toolkit".'
  exit 3
}
if ($config.app -and (Test-Path -LiteralPath $config.app -PathType Leaf)) {
  Add-Type -AssemblyName System.Windows.Forms
  $answer = [System.Windows.Forms.MessageBox]::Show("Toolkit could not start (code $code). Open T3 Code with Toolkit disabled for this session?", 'T3CodeToolkit', 'YesNo')
  if ($answer -eq 'Yes') {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    if (-not $config.keepTelemetry -and $args -notcontains '--keep-telemetry') { $env:T3CODE_TELEMETRY_ENABLED = 'false' }
    try {
      Start-Process -FilePath $config.app -ErrorAction Stop
      Show-Message 'Toolkit is disabled for this launch. To use it next time, quit T3 Code and open "T3 Code + Toolkit".'
      exit 0
    } catch {
      Show-Message "Windows could not start T3 Code: $($_.Exception.Message)"
    }
  }
} else {
  Show-Message "T3 Code + Toolkit stopped with an error (code $code). See launcher.log in $dir."
}
exit $code
