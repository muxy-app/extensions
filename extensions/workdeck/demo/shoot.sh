#!/bin/sh
# Renders the demo pages with invented data and saves English README screenshots to assets/screenshots/.
# Needs Google Chrome and python3. Run from anywhere: sh demo/shoot.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/screenshots"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8765
mkdir -p "$OUT"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
curl -fsS "http://localhost:$PORT/demo/loader.html" >/dev/null || { echo "local server did not start on port $PORT"; exit 1; }
# Optional arguments pick scenes by number prefix, e.g. `sh demo/shoot.sh 08 09`; no argument shoots everything.
wanted() { [ "$#" -eq 0 ] && return 0; for w in "$@"; do case "$name" in "$w"*) return 0;; esac; done; return 1; }
ARGS="$*"
shot() { # name, query string, minimum size in bytes (smaller means the page was captured before it finished drawing)
  name="$1"
  # shellcheck disable=SC2086
  wanted $ARGS || return 0
  min="${3:-60000}"
  for attempt in 1 2 3; do
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1600,1000 \
      --virtual-time-budget=40000 --screenshot="$OUT/$1.png" "http://localhost:$PORT/demo/shell.html?$2" 2>&1 | grep -i -E "error|fail" | head -3 || true
    size=$(stat -f%z "$OUT/$1.png" 2>/dev/null || echo 0)
    [ "$size" -ge "$min" ] && { echo "saved $1.png ($size bytes)"; return 0; }
    echo "retry $1 (attempt $attempt gave $size bytes)"; sleep 2
  done
  echo "FAILED $1.png"
}
shot 01-sidebar-issues   "right=tab/issues.html&rscenario=issues-gh&tabs=npm%20run%20dev,Checkout%20flow,Issues"
shot 02-linear-groups    "right=tab/issues.html&rscenario=issues-linear&tabs=npm%20run%20dev,Checkout%20flow,Issues"
shot 03-pr-review        "right=tab/deploys.html&rscenario=deploys-pr&tabs=npm%20run%20dev,Checkout%20flow,Deploys"
shot 04-actions          "right=tab/deploys.html&rscenario=deploys-actions&tabs=npm%20run%20dev,Checkout%20flow,Deploys"
shot 05-branch-cleanup   "right=tab/cleanup.html&tabs=npm%20run%20dev,Checkout%20flow,Branch%20cleanup"
shot 06-agent-board      "right=tab/board.html&rscenario=board-alert&tabs=npm%20run%20dev,Checkout%20flow,Agent%20control%20room"
shot 07-new-issue-linear "right=tab/board.html&modal=modal/create.html&mscenario=modal-linear&tabs=npm%20run%20dev,Checkout%20flow,Agent%20control%20room" 150000
shot 08-chat-to-issue    "right=tab/board.html&modal=modal/create.html&mscenario=modal-chat&tabs=npm%20run%20dev,Checkout%20flow,Agent%20control%20room" 150000
shot 11-issue-agent      "right=tab/issues.html&rscenario=issues-agent&tabs=npm%20run%20dev,Checkout%20flow,Issues"
shot 10-notes            "right=notes/notes.html&tabs=npm%20run%20dev,Checkout%20flow,Notes"
shot 09-chat-draft       "right=tab/board.html&modal=modal/create.html&mscenario=modal-draft&tabs=npm%20run%20dev,Checkout%20flow,Agent%20control%20room" 150000
