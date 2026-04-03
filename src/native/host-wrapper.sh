#!/bin/sh
# Chrome launches this script as the native messaging host.
# It resolves its own directory and invokes the Node.js host.
#
# NOTE: This wrapper is only used for local development.
# The install-host.sh script creates a separate wrapper in
# ~/.local/share/llm-native-host/ with an absolute node path.

DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
exec node "$DIR/host.js"
