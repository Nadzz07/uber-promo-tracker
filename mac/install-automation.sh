#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.nadzz07.uber-promo-tracker.plist"
LOG_DIR="$HOME/Library/Logs/UberPromoTracker"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

NODE_DIR="$(dirname "$(command -v node)")"
GIT_BIN="$(command -v git 2>/dev/null || printf '/usr/bin/git')"
GIT_DIR="$(dirname "$GIT_BIN")"
AUTOMATION_PATH="$NODE_DIR:$GIT_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.nadzz07.uber-promo-tracker</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${REPO_DIR}/mac/update-promos.sh</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${REPO_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${AUTOMATION_PATH}</string>
  </dict>

  <key>StartInterval</key>
  <integer>3600</integer>

  <key>RunAtLoad</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>300</integer>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/output.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/error.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Hourly Uber Eats Promo Tracker automation installed."
echo "Logs: $LOG_DIR"
echo "PATH used by launchd: $AUTOMATION_PATH"
