#!/bin/sh
# Double-click this in Finder to install T3CodeToolkit on macOS (it runs install.sh).
cd "$(dirname "$0")" && sh ./install.sh "$@"
status=$?
echo
echo "You can close this window."
exit $status
