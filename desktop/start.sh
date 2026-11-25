#!/bin/sh
# Starts T3 Code with T3CodeToolkit (macOS and Linux). The installer's app/menu entry runs this.
# It runs the launcher with T3 Code's own binary as Node, so Node doesn't need to be installed.
DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$(cat "$DIR/runtime.txt" 2>/dev/null)"

if [ ! -x "$RUNTIME" ]; then
  # An AppImage update renames the file. Look for the newest one, then fall back to Node.
  RUNTIME="$(ls -t "$HOME"/Applications/*.AppImage "$HOME"/Downloads/*.AppImage "$HOME"/.local/bin/*.AppImage \
    "$HOME"/bin/*.AppImage "$HOME"/Desktop/*.AppImage /opt/*.AppImage 2>/dev/null | grep -i 't3.\{0,1\}code' | head -n 1)"
  [ -n "$RUNTIME" ] || RUNTIME="$(command -v node || true)"
fi

notify() {
  if [ "$(uname -s)" = Darwin ]; then
    osascript -e "display dialog \"$1\" with title \"T3CodeToolkit\" buttons {\"OK\"} default button 1" >/dev/null 2>&1
  elif command -v zenity >/dev/null 2>&1; then
    zenity --info --title=T3CodeToolkit --text="$1" >/dev/null 2>&1
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send T3CodeToolkit "$1"
  fi
  echo "T3CodeToolkit: $1" >&2
}

if [ -z "$RUNTIME" ]; then
  notify "T3 Code was not found. Reinstall T3 Code, then run the T3CodeToolkit installer again."
  exit 1
fi

ELECTRON_RUN_AS_NODE=1 "$RUNTIME" "$DIR/launch.mjs" "$@" >>"$DIR/launcher-output.log" 2>&1
code=$?
if [ "$code" -eq 3 ]; then
  notify "T3 Code was already running, so the toolkit could not attach. Quit T3 Code, then start it again from T3 Code + Toolkit."
elif [ "$code" -ne 0 ]; then
  notify "T3 Code + Toolkit stopped with an error (code $code). See launcher.log in $DIR."
fi
exit "$code"
