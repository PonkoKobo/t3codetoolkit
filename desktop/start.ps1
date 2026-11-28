# The Start Menu shortcut and Windows sign-in task run this hidden.
$dir = $PSScriptRoot
$outputLog = Join-Path $dir 'launcher-output.log'
$launcher = Join-Path $dir 'launch.mjs'

function Write-LaunchLog($message) {
  Add-Content -LiteralPath $outputLog -Value "[$(Get-Date -Format o)] $message" -Encoding utf8 -ErrorAction SilentlyContinue
}

function Show-LaunchDialog($summary, $details, [switch]$canOpenApp) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  $dialog = New-Object System.Windows.Forms.Form
  $dialog.Text = 'T3 Code + Toolkit'
  $dialog.StartPosition = 'CenterScreen'
  $dialog.ClientSize = New-Object System.Drawing.Size(620, 248)
  $dialog.MinimumSize = $dialog.Size

  $heading = New-Object System.Windows.Forms.Label
  $heading.Text = $summary
  $heading.SetBounds(16, 14, 588, 25)
  $dialog.Controls.Add($heading)

  $body = New-Object System.Windows.Forms.TextBox
  $body.Multiline = $true
  $body.ReadOnly = $true
  $body.ScrollBars = 'Vertical'
  $body.Text = $details
  $body.SetBounds(16, 42, 588, 148)
  $body.Anchor = 'Top, Bottom, Left, Right'
  $dialog.Controls.Add($body)

  $actions = New-Object System.Windows.Forms.FlowLayoutPanel
  $actions.Dock = 'Bottom'
  $actions.Height = 48
  $actions.Padding = New-Object System.Windows.Forms.Padding(12, 4, 12, 0)
  $dialog.Controls.Add($actions)

  $logs = New-Object System.Windows.Forms.Button
  $logs.Text = 'Open log folder'
  $logs.AutoSize = $true
  $logs.Add_Click({ Start-Process -FilePath explorer.exe -ArgumentList ('"' + $dir + '"') })
  $actions.Controls.Add($logs)

  if ($canOpenApp) {
    $open = New-Object System.Windows.Forms.Button
    $open.Text = 'Open without Toolkit'
    $open.AutoSize = $true
    $open.DialogResult = 'Yes'
    $actions.Controls.Add($open)
  }
  $close = New-Object System.Windows.Forms.Button
  $close.Text = 'Close'
  $close.AutoSize = $true
  $close.DialogResult = 'Cancel'
  $actions.Controls.Add($close)
  $dialog.CancelButton = $close
  $dialog.ActiveControl = $close
  try { return $dialog.ShowDialog() } finally { $dialog.Dispose() }
}

$config = $null
try {
  $config = Get-Content -LiteralPath (Join-Path $dir 'config.json') -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
} catch {
  Write-LaunchLog "Could not read config.json: $($_.Exception.Message)"
}
$recordedRuntime = "$(Get-Content -LiteralPath (Join-Path $dir 'runtime.txt') -Raw -ErrorAction SilentlyContinue)".Trim()
$candidates = @($env:T3TK_APP, $config.app)
$appFolders = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\t3code')
  (Join-Path $env:ProgramFiles 't3code')
  (Join-Path $env:ProgramFiles 'T3 Code')
)
foreach ($folder in $appFolders) {
  $candidates += (Join-Path $folder 'T3 Code (Beta).exe'), (Join-Path $folder 'T3 Code.exe')
}
$candidates += $recordedRuntime
$app = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
$runtime = $app
if (-not $runtime) {
  $runtime = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
}

Write-LaunchLog "Starting Toolkit $($config.version). Runtime: $runtime"
$exitCode = $null
$stage = 'Starting the Toolkit launcher'
$detail = $null
if (-not $runtime) {
  $detail = 'Windows could not find the T3 Code executable or a Node.js runtime. Reinstall T3 Code, then run the Toolkit installer again.'
} elseif (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  $detail = 'The Toolkit launcher file (launch.mjs) is missing. Run the Toolkit installer again.'
} else {
  $previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
  $env:ELECTRON_RUN_AS_NODE = '1'
  $LASTEXITCODE = $null
  $lastError = $null
  try {
    & $runtime $launcher @args 2>&1 | ForEach-Object {
      $line = $_.ToString()
      if ($line -match '^T3CodeToolkit: ERROR: (.+)$') { $detail = $Matches[1] }
      if ($line -match '^\w*Error: .+') { $lastError = $line }
      $line
    } | Out-File -LiteralPath $outputLog -Append -Encoding utf8 -ErrorAction Stop
    $exitCode = $LASTEXITCODE
  } catch {
    $detail = $_.Exception.GetBaseException().Message
  } finally {
    $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
  }
  if ($null -ne $exitCode -and $exitCode -eq 0) { exit 0 }

  if ($null -ne $exitCode) {
    $stage = 'Running the Toolkit launcher'
    if (-not $detail) { $detail = $lastError }
    if (-not $detail) { $detail = 'The launcher stopped before it could report why.' }
  } elseif (-not $detail) {
    $detail = 'Windows did not return a process exit code.'
  }
}

$existingWindow = $null
# Electron on Windows can return 130 when another instance accepts the launch.
if (($exitCode -eq 3 -or $exitCode -eq 130) -and $app) {
  $appName = [IO.Path]::GetFileNameWithoutExtension($app)
  $session = (Get-Process -Id $PID).SessionId
  $existingWindow = Get-Process -Name $appName -ErrorAction SilentlyContinue | Where-Object {
    $_.SessionId -eq $session -and $_.MainWindowHandle -ne 0 -and $_.Path -eq $app
  } | Select-Object -First 1
}
if ($existingWindow) {
  $summary = 'T3 Code is already open'
  $stage = 'Handing off to the existing T3 Code window'
  $detail = 'Check the open window for the Toolkit button. If it is missing, quit T3 Code and reopen it from "T3 Code + Toolkit".'
} else {
  $summary = 'T3 Code + Toolkit could not start'
}
$exitStatus = if ($null -eq $exitCode) { 'Unavailable' } else { "$exitCode" }
$version = if ($config.version) { $config.version } else { 'Unknown' }
$logs = "Diagnostics: $outputLog`r`nLauncher events: $(Join-Path $dir 'launcher.log')"
$details = "$detail`r`n`r`nStep: $stage`r`nToolkit version: $version`r`nExit status: $exitStatus`r`n`r`n$logs"
Write-LaunchLog "$stage (exit status $exitStatus). $detail"
$answer = Show-LaunchDialog $summary $details -canOpenApp:([bool]$app -and -not $existingWindow)
if ($answer -eq 'Yes') {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  if ($config.telemetryOff -is [bool] -and $config.telemetryOff -and $args -notcontains '--keep-telemetry') {
    $env:T3CODE_TELEMETRY_ENABLED = 'false'
  }
  try {
    Start-Process -FilePath $app -ErrorAction Stop
    Write-LaunchLog 'Opened T3 Code without Toolkit for this session.'
    exit 0
  } catch {
    Write-LaunchLog "Windows could not open T3 Code: $($_.Exception.Message)"
    [void](Show-LaunchDialog 'Windows could not open T3 Code' "$($_.Exception.Message)`r`n`r`n$logs")
  }
}
if ($null -eq $exitCode) { exit 1 }
exit $exitCode
