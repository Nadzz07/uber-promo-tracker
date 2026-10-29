#!/bin/bash
# Update the existing tracker agent without replacing its runtime or adding a job.
set -euo pipefail
[[ "${1:-}" == --daily ]] || { echo 'Usage: bash mac/set-sync-schedule.sh --daily' >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || { echo 'Run this on the Mac that handles Mail.' >&2; exit 1; }
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.nadzz07.uber-promo-tracker.plist"
DOMAIN="gui/$(id -u)"
[[ -f "$PLIST" ]] || { echo 'No existing tracker agent. Run mac/install-automation.sh on the Mail Mac.' >&2; exit 1; }
if launchctl print "$DOMAIN/com.nadzz07.uber-promo-tracker" 2>/dev/null | /usr/bin/grep -q 'state = running'; then
 echo 'A sync is running. Wait for it to finish before changing its schedule.' >&2; exit 1
fi
python3 - "$PLIST" "$REPO_DIR" <<'PY'
import os,plistlib,sys,tempfile
from pathlib import Path
p,root=Path(sys.argv[1]),Path(sys.argv[2]);original=p.read_bytes();v=plistlib.loads(original)
if v.get('Label')!='com.nadzz07.uber-promo-tracker' or v.get('WorkingDirectory')!=str(root):raise SystemExit('Agent does not belong to this tracker checkout.')
backup=root/'outputs'/'sync-data.local'/'schedule-before.local.plist';backup.parent.mkdir(parents=True,exist_ok=True)
if not backup.exists():backup.write_bytes(original);backup.chmod(0o600)
v['StartInterval']=86400;v.pop('StartCalendarInterval',None)
fd,name=tempfile.mkstemp(prefix='.tracker-schedule-',dir=p.parent)
try:
 with os.fdopen(fd,'wb') as f:plistlib.dump(v,f)
 os.chmod(name,0o600);os.replace(name,p)
finally:
 if os.path.exists(name):os.unlink(name)
PY
plutil -lint "$PLIST"
launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
REPORT="$(node "$REPO_DIR/mac/report-sync-schedule.js")"
node -e 'const r=JSON.parse(process.argv[1]);if(r.state!=="enabled"||r.intervalSeconds!==86400)process.exit(1);console.log("Existing tracker agent verified: daily (86400 seconds).")' "$REPORT"
