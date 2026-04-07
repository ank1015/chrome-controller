#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./install_ext_and_restart_chrome_mac.sh "Work"
#
# Input:
#   - Chrome profile display name (e.g. "Work", "Personal")
#     OR a profile directory name (e.g. "Default", "Profile 2")
#
# This script:
#   1) Writes the external extension JSON for macOS
#   2) Snapshots the currently active Chrome profiles
#   3) Fully quits Chrome
#   4) Clears the external-uninstall block for the target profile
#   5) Installs the native messaging host manifest and wrapper inline
#   6) Relaunches the target profile first
#   7) Restores all other previously active profiles

EXT_ID="lpckahomnighbpahilageendcdpbkfcl"
HOST_NAME="com.ank1015.llm"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <chrome-profile-name-or-dir>" >&2
  exit 1
fi

TARGET_INPUT="$1"

CHROME_APP="/Applications/Google Chrome.app"
CHROME_BIN="$CHROME_APP/Contents/MacOS/Google Chrome"
CHROME_DIR="$HOME/Library/Application Support/Google/Chrome"
LOCAL_STATE="$CHROME_DIR/Local State"
EXT_DIR="$CHROME_DIR/External Extensions"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
HOST_JS="$DIST_DIR/native/host.js"
HOST_INSTALL_DIR="$HOME/.local/share/llm-native-host/$HOST_NAME"
HOST_WRAPPER_PATH="$HOST_INSTALL_DIR/run-host.sh"
HOST_MANIFEST_DIR="${CHROME_NATIVE_HOSTS_DIR:-$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts}"
HOST_MANIFEST_PATH="$HOST_MANIFEST_DIR/$HOST_NAME.json"

install_native_host() {
  local node_path
  node_path="$(command -v node || true)"

  if [[ -z "$node_path" ]]; then
    echo "Error: node was not found in PATH." >&2
    exit 1
  fi

  if [[ ! -f "$HOST_JS" ]]; then
    echo "Error: native host entrypoint not found: $HOST_JS" >&2
    echo "Build the package first so dist/native/host.js exists." >&2
    exit 1
  fi

  rm -rf "$HOST_INSTALL_DIR"
  mkdir -p "$HOST_INSTALL_DIR"

  cat > "$HOST_WRAPPER_PATH" <<EOF
#!/bin/sh
exec "$node_path" "$HOST_JS"
EOF
  chmod 0755 "$HOST_WRAPPER_PATH"

  mkdir -p "$HOST_MANIFEST_DIR"
  cat > "$HOST_MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "LLM native messaging host",
  "path": "$HOST_WRAPPER_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

  echo "Installed native messaging host:"
  echo "  extension: $EXT_ID"
  echo "  node:      $node_path"
  echo "  host.js:   $HOST_JS"
  echo "  wrapper:   $HOST_WRAPPER_PATH"
  echo "  manifest:  $HOST_MANIFEST_PATH"
}

if [[ ! -x "$CHROME_BIN" ]]; then
  echo "Chrome binary not found: $CHROME_BIN" >&2
  exit 1
fi

if [[ ! -f "$LOCAL_STATE" ]]; then
  echo "Chrome Local State not found: $LOCAL_STATE" >&2
  exit 1
fi

mkdir -p "$EXT_DIR"

TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

ACTIVE_PROFILES_FILE="$TMPDIR_ROOT/active_profiles.txt"
TARGET_PROFILE_FILE="$TMPDIR_ROOT/target_profile.txt"
TARGET_PREFS_FILE="$TMPDIR_ROOT/target_prefs.txt"

# Resolve the user's profile input to a Chrome profile directory,
# and snapshot the currently active profiles before Chrome quits.
python3 - "$LOCAL_STATE" "$TARGET_INPUT" "$ACTIVE_PROFILES_FILE" "$TARGET_PROFILE_FILE" "$TARGET_PREFS_FILE" <<'PY'
import json
import os
import sys

local_state_path, target_input, active_out, target_profile_out, target_prefs_out = sys.argv[1:]

with open(local_state_path, "r", encoding="utf-8") as f:
    data = json.load(f)

profile = data.get("profile", {})
active = profile.get("last_active_profiles") or []
last_used = profile.get("last_used")
info_cache = profile.get("info_cache", {}) or {}

# Preserve order, remove duplicates.
seen = set()
active_clean = []
for p in active:
    if p and p not in seen:
        active_clean.append(p)
        seen.add(p)

if not active_clean and last_used:
    active_clean = [last_used]

# Map profile dir -> display name
mapping = []
for profile_dir, meta in info_cache.items():
    display_name = meta.get("name") or meta.get("user_name") or profile_dir
    mapping.append((profile_dir, display_name))

target_profile = None

# Exact profile-dir match
for profile_dir, display_name in mapping:
    if target_input == profile_dir:
        target_profile = profile_dir
        break

# Exact display-name match
if target_profile is None:
    for profile_dir, display_name in mapping:
        if target_input == display_name:
            target_profile = profile_dir
            break

# Fallback: accept raw profile dir like "Default" or "Profile 2"
if target_profile is None and target_input:
    target_profile = target_input

chrome_dir = os.path.expanduser("~/Library/Application Support/Google/Chrome")
target_prefs = os.path.join(chrome_dir, target_profile, "Preferences")

with open(active_out, "w", encoding="utf-8") as f:
    for p in active_clean:
        f.write(p + "\n")

with open(target_profile_out, "w", encoding="utf-8") as f:
    f.write(target_profile + "\n")

with open(target_prefs_out, "w", encoding="utf-8") as f:
    f.write(target_prefs + "\n")
PY

TARGET_PROFILE="$(tr -d '\r' < "$TARGET_PROFILE_FILE" | head -n 1)"
TARGET_PREFS="$(tr -d '\r' < "$TARGET_PREFS_FILE" | head -n 1)"

if [[ -z "$TARGET_PROFILE" ]]; then
  echo "Could not resolve target profile." >&2
  exit 1
fi

if [[ ! -f "$TARGET_PREFS" ]]; then
  echo "Target profile Preferences file not found: $TARGET_PREFS" >&2
  exit 1
fi

echo "Target profile: $TARGET_PROFILE"
echo "Target prefs:   $TARGET_PREFS"
echo "Host.js:        $HOST_JS"
echo "Host manifest:  $HOST_MANIFEST_PATH"

# 1) Write the external extension JSON for this macOS user.
cat > "$EXT_DIR/${EXT_ID}.json" <<EOF
{
  "external_update_url": "https://clients2.google.com/service/update2/crx"
}
EOF
chmod 0644 "$EXT_DIR/${EXT_ID}.json"

echo "Wrote external extension metadata:"
echo "  $EXT_DIR/${EXT_ID}.json"

# 2) Quit Chrome fully before reinstall / restore.
osascript <<'APPLESCRIPT'
tell application id "com.google.Chrome"
  if running then quit
end tell
APPLESCRIPT

for _ in {1..150}; do
  if ! pgrep -x "Google Chrome" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

pkill -x "Google Chrome" >/dev/null 2>&1 || true
pkill -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" >/dev/null 2>&1 || true
sleep 1

# 3) Clear the remembered "external uninstall" block for the target profile.
python3 - "$TARGET_PREFS" "$EXT_ID" <<'PY'
import json
import os
import shutil
import sys
import tempfile

prefs_path, ext_id = sys.argv[1], sys.argv[2]

with open(prefs_path, "r", encoding="utf-8") as f:
    prefs = json.load(f)

exts = prefs.setdefault("extensions", {})
uninstalls = exts.get("external_uninstalls", [])

if isinstance(uninstalls, list):
    exts["external_uninstalls"] = [x for x in uninstalls if x != ext_id]
else:
    exts["external_uninstalls"] = []

fd, tmp_path = tempfile.mkstemp(
    prefix="prefs.",
    suffix=".json",
    dir=os.path.dirname(prefs_path),
)
os.close(fd)

with open(tmp_path, "w", encoding="utf-8") as f:
    json.dump(prefs, f, separators=(",", ":"))

shutil.move(tmp_path, prefs_path)
PY

echo "Cleared external uninstall block for:"
echo "  extension=$EXT_ID"
echo "  profile=$TARGET_PROFILE"

# 4) Register / update the native messaging host for the fixed extension ID.
echo "Installing native messaging host..."
install_native_host

# 5) Relaunch target profile first.
echo "Launching target profile first: $TARGET_PROFILE"
"$CHROME_BIN" \
  --profile-directory="$TARGET_PROFILE" \
  --restore-last-session \
  >/dev/null 2>&1 &
sleep 2

# 6) Restore all other previously active profiles.
if [[ -s "$ACTIVE_PROFILES_FILE" ]]; then
  while IFS= read -r profile_dir; do
    [[ -z "$profile_dir" ]] && continue
    [[ "$profile_dir" == "$TARGET_PROFILE" ]] && continue

    echo "Restoring previously active profile: $profile_dir"
    "$CHROME_BIN" \
      --profile-directory="$profile_dir" \
      --restore-last-session \
      >/dev/null 2>&1 &
    sleep 1.2
  done < "$ACTIVE_PROFILES_FILE"
fi

# 7) Bring Chrome to front.
open -a "Google Chrome"

cat <<EOF

Done.

What happened:
- External install JSON was written for extension: $EXT_ID
- Chrome was fully restarted
- The external-uninstall block was cleared for target profile: $TARGET_PROFILE
- Native messaging host installer was run for extension: $EXT_ID
- The target profile was reopened first
- All previously active profiles were restored

EOF
