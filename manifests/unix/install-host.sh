#!/bin/sh
# Installs the native messaging host manifest on macOS or Linux.
# Usage: ./install-host.sh <extension-id>

set -eu

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "Usage: ./install-host.sh <extension-id>"
  exit 0
fi

EXTENSION_ID="${1:-}"

if [ -z "$EXTENSION_ID" ]; then
  echo "Usage: ./install-host.sh <extension-id>" >&2
  exit 1
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
MANIFESTS_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
PACKAGE_DIR="$(CDPATH= cd -- "$MANIFESTS_DIR/.." && pwd)"
DIST_DIR="$PACKAGE_DIR/dist"

if [ ! -f "$DIST_DIR/native/host.js" ]; then
  echo "Error: host.js not found. Run 'pnpm build' in packages/extension first." >&2
  exit 1
fi

NODE_PATH="$(command -v node || true)"

if [ -z "$NODE_PATH" ]; then
  echo "Error: node was not found in PATH." >&2
  exit 1
fi

INSTALL_DIR="$HOME/.local/share/llm-native-host/com.ank1015.llm"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

WRAPPER_PATH="$INSTALL_DIR/run-host.sh"
cat > "$WRAPPER_PATH" <<WRAPPER
#!/bin/sh
exec "$NODE_PATH" "$DIST_DIR/native/host.js"
WRAPPER
chmod 755 "$WRAPPER_PATH"

if [ -n "${CHROME_NATIVE_HOSTS_DIR:-}" ]; then
  MANIFEST_DIR="$CHROME_NATIVE_HOSTS_DIR"
else
  OS_NAME="$(uname -s)"
  case "$OS_NAME" in
    Darwin)
      MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
      ;;
    Linux)
      MANIFEST_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/google-chrome/NativeMessagingHosts"
      ;;
    *)
      echo "Error: unsupported platform '$OS_NAME'" >&2
      exit 1
      ;;
  esac
fi

mkdir -p "$MANIFEST_DIR"
MANIFEST_PATH="$MANIFEST_DIR/com.ank1015.llm.json"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "com.ank1015.llm",
  "description": "LLM native messaging host",
  "path": "$WRAPPER_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

echo "Installed native host for Chrome."
echo "  extension: $EXTENSION_ID"
echo "  node: $NODE_PATH"
echo "  host.js: $DIST_DIR/native/host.js"
echo "  wrapper: $WRAPPER_PATH"
echo "  manifest: $MANIFEST_PATH"

if [ "${CHROME_NATIVE_HOSTS_DIR:-}" = "" ] && [ "$(uname -s)" = "Linux" ]; then
  echo ""
  echo "Tip: set CHROME_NATIVE_HOSTS_DIR if your Chrome/Chromium uses a different NativeMessagingHosts directory."
fi

echo ""
echo "Restart Chrome fully and reload the unpacked extension."
