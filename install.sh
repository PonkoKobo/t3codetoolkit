#!/bin/sh
# Installs T3CodeToolkit for the T3 Code desktop app on macOS and Linux.
#   ./install.sh                install, and add "T3 Code + Toolkit" (~/Applications on macOS,
#                               the applications menu on Linux)
#   ./install.sh --uninstall    remove it again
# Runs the installer with T3 Code's own binary as Node, so Node doesn't need to be installed.
set -eu
cd "$(dirname "$0")"

APP="${T3TK_APP:-}"
if [ -z "$APP" ]; then
  if [ "$(uname -s)" = Darwin ]; then
    for app in /Applications/T3\ Code*.app "$HOME"/Applications/T3\ Code*.app; do
      [ -d "$app" ] || continue
      exe="$app/Contents/MacOS/$(basename "$app" .app)"
      if [ -x "$exe" ]; then APP="$exe"; break; fi
    done
  else
    APP="$(ls -t "$HOME"/Applications/*.AppImage "$HOME"/Downloads/*.AppImage "$HOME"/.local/bin/*.AppImage \
      "$HOME"/bin/*.AppImage "$HOME"/Desktop/*.AppImage /opt/*.AppImage 2>/dev/null | grep -i 't3.\{0,1\}code' | head -n 1 || true)"
  fi
fi

if [ ! -f dist/t3tk-core.js ] && command -v npm >/dev/null 2>&1; then
  npm install --no-audit --no-fund && npm run build
fi

if [ -n "$APP" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$APP" desktop/install.mjs --app "$APP" "$@"
elif command -v node >/dev/null 2>&1; then
  exec node desktop/install.mjs "$@"
else
  echo "T3 Code was not found. Install it, or set T3TK_APP to the T3 Code executable (or AppImage)." >&2
  exit 1
fi
