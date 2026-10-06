#!/bin/zsh
# Run every page in the suite and summarise.
#
#   ./test-all.sh
#
# Each page gets its own Chrome, its own storage and its own report files, so
# one failure cannot leak into the next.
set -u
HERE="${0:A:h}"
PAGES=("parsecheck.html:60" "probe.html:220" "play-through.html:240" "memphobe.html:60")

cd "$HERE"

total=0
for spec in "${PAGES[@]}"; do
  page="${spec%%:*}"
  wait="${spec##*:}"
  out="$("$HERE/run.sh" "$page" "$wait" 2>&1)"
  echo "== $page"
  echo "$out" | grep -E '^(FAIL|failures)' || true
  echo "$out" | grep -cE '^(PASS|OK)' | sed 's/^/   /' | tr -d '\n'
  echo " checks passed"
  # The final line is "failures N"; anything else means the page never finished.
  if ! echo "$out" | grep -q '^failures 0$'; then
    total=1
    echo "   ^^ FAILED"
  fi
  echo
done

if [ "$total" -eq 0 ]; then
  echo "all pages clean"
  # Nothing to debug, so nothing to keep. The reports are rebuilt on demand.
  rm -f "$HERE/.report.txt" "$HERE/.report.final.txt" \
        "$HERE/.chrome.log" "$HERE/.server.log"
else
  echo "there are failures above"
  echo "reports kept in $HERE/.report.txt and $HERE/.report.final.txt"
fi
exit $total