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
if ($code -eq 3) {
  Show-Message 'T3 Code was already running, so the toolkit could not attach. Quit T3 Code, then start it again from the "T3 Code + Toolkit" shortcut.'
} elseif ($code -ne 0) {
  Show-Message "T3 Code + Toolkit stopped with an error (code $code). See launcher.log in $dir."
}
exit $code
