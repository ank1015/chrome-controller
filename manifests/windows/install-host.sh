#!/bin/sh
# Compatibility wrapper for older shell-based instructions.

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
exec node "$SCRIPT_DIR/install-host.mjs" "$@"
