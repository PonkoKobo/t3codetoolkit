#!/bin/sh
# Persistently turns T3 Code product analytics off (or back on) via your shell profile.
# The desktop app reads T3CODE_TELEMETRY_ENABLED from your login shell; quit and restart T3 Code afterwards.
# Only the marked block below is ever added or removed; nothing else in the profile is touched.
set -eu
mode="${1:-off}"
case "$mode" in off|on) ;; *) echo "Usage: $0 [off|on]" >&2; exit 2 ;; esac

profile="${HOME}/.profile"
if [ -n "${ZSH_VERSION:-}" ] || [ "$(basename "${SHELL:-}")" = zsh ]; then profile="${HOME}/.zprofile"; fi
begin="# >>> T3CodeToolkit telemetry >>>"
end="# <<< T3CodeToolkit telemetry <<<"

touch "$profile"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
awk -v b="$begin" -v e="$end" '$0==b{skip=1;next} $0==e{skip=0;next} !skip' "$profile" > "$tmp"
if [ "$mode" = off ]; then
  printf '%s\nexport T3CODE_TELEMETRY_ENABLED=false\n%s\n' "$begin" "$end" >> "$tmp"
fi
cp "$profile" "$profile.t3tk.bak"
cat "$tmp" > "$profile"

if [ "$mode" = off ]; then
  echo "Added T3CODE_TELEMETRY_ENABLED=false to $profile (backup: $profile.t3tk.bak). Quit and restart T3 Code."
else
  echo "Removed the toolkit's setting from $profile (backup: $profile.t3tk.bak)."
fi
