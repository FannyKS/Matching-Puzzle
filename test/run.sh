#!/bin/zsh
# Run a probe page in headless Chrome and print what it reported.
#
# --dump-dom is deliberately not used: it exits Chrome at the load event, which
# kills the page long before any asynchronous work finishes. Chrome is kept
# alive with a debugging port instead, and run.sh waits for the page to post
# its ending to /report-final.
#
#   usage: ./run.sh <page.html> [seconds]
#
# Pages live in test/ and are served from the project root, so a page refers to
# the game as ../index.html.
set -u
HERE="${0:A:h}"
PAGE="${1:-probe.html}"
WAIT="${2:-200}"
PORT=8765
REPORT="$HERE/.report.txt"
FINAL="$HERE/.report.final.txt"
CHROME_LOG="$HERE/.chrome.log"

cd "$HERE/.."

# Fixtures are generated, not committed: they are flat colour grids, and a
# binary blob in the repo would only drift from the generator.
python3 "$HERE/make-fixtures.py" >/dev/null || exit 1

# A server left over from an earlier run would still hold the port.
lsof -ti:"$PORT" 2>/dev/null | xargs kill 2>/dev/null
rm -f "$REPORT" "$FINAL" "$CHROME_LOG"
rm -rf "$HERE/.chrome-profile"

python3 "$HERE/server.py" serve "$PORT" "$REPORT" "$FINAL" >"$HERE/.server.log" 2>&1 &
SERVER=$!
for i in $(seq 1 40); do
  sleep 0.25
  lsof -ti:"$PORT" >/dev/null 2>&1 && break
done

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
[ -x "$CHROME" ] || { echo "!! no Chrome found"; kill $SERVER 2>/dev/null; exit 1; }

"$CHROME" \
  --headless=new --disable-gpu --no-sandbox \
  --user-data-dir="$HERE/.chrome-profile" \
  --remote-debugging-port=9333 \
  "http://127.0.0.1:$PORT/test/$PAGE" >"$CHROME_LOG" 2>&1 &
BROWSER=$!

for i in $(seq 1 "$WAIT"); do
  sleep 1
  # A throw is written straight to the progress file, so stop on either.
  [ -f "$FINAL" ] && break
  grep -q "^THREW" "$REPORT" 2>/dev/null && break
done
sleep 1

kill $BROWSER $SERVER 2>/dev/null
pkill -f "chrome-profile" 2>/dev/null
rm -rf "$HERE/.chrome-profile"

# The reports have been read by now. Keep them only when something went wrong,
# so a clean run leaves nothing behind but the log of what passed.
# Reports are left in place for the caller to read; run-all.sh tidies up.

if [ -f "$FINAL" ]; then
  cat "$FINAL"
elif grep -q "^THREW" "$REPORT" 2>/dev/null; then
  cat "$REPORT"
  echo
  echo "!! did not finish"
else
  echo "!! TIMED OUT after ${WAIT}s -- last progress:"
  tail -6 "$REPORT" 2>/dev/null || echo "nothing was ever reported"
  exit 1
fi