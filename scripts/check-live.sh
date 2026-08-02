#!/usr/bin/env bash
#
# Can the deployed site predict for a given month?
#
# Checks the live origin, not the repository: a green build proves the artifact
# was correct when it was made, which is not the same claim.
#
#   scripts/check-live.sh [site-url] [month]
#
# Month defaults to the current UTC month. Pass one explicitly to rehearse a
# boundary — `scripts/check-live.sh https://hfkit.caldwell.tech 09` answers
# "would the site still work on 1 September?"
#
# Exit 0 if it can predict, 1 if it cannot.

set -uo pipefail

SITE="${1:-${SITE_URL:-https://hfkit.caldwell.tech}}"
SITE="${SITE%/}"
MONTH="${2:-$(date -u +%m)}"
fail=0

# A 200 is not enough. Static hosts answer a missing path with their own error
# page and a 200 — Cloudflare's SPA fallback does exactly that — so a bare
# status check would call a missing 11 MB data file "present".
#
# The body is fetched and measured rather than read from content-length, which
# hosts omit for anything they compress. Downloading it is also the stronger
# claim: it proves the whole file is retrievable, not just that headers exist.
check_file() {
  local path="$1" min="$2" label="${3:-$1}"
  local url="$SITE/data/itu/$path"
  local body meta status ctype len

  body=$(mktemp)
  if ! meta=$(curl -sSL --compressed --max-time 180 -o "$body" \
        -w '%{http_code} %{content_type}' "$url" 2>&1); then
    echo "FAIL  $label — could not be fetched: $meta"
    rm -f "$body"
    fail=1
    return
  fi
  status="${meta%% *}"
  ctype=$(printf '%s' "${meta#* }" | tr '[:upper:]' '[:lower:]')
  len=$(wc -c < "$body" | tr -d ' ')
  rm -f "$body"

  if [ "$status" != "200" ]; then
    echo "FAIL  $label — HTTP $status"
    fail=1
    return
  fi
  case "$ctype" in
    *html*)
      echo "FAIL  $label — served an HTML page ($ctype), not data."
      echo "      The host answered a missing file with 200. It was never published."
      fail=1
      return
      ;;
  esac
  if [ "$len" -lt "$min" ]; then
    echo "FAIL  $label — $len bytes, expected at least $min"
    fail=1
    return
  fi
  printf 'ok    %-28s %10s bytes  %s\n' "$label" "$len" "$ctype"
}

echo "Checking $SITE for month $MONTH"
check_file "ionos${MONTH}.bin"  4000000 "ionos${MONTH}.bin"
check_file "COEFF${MONTH}W.txt"  100000 "COEFF${MONTH}W.txt"
check_file "P1239-3%20Decile%20Factors.txt" 10000 "P1239-3 Decile Factors.txt"

for page in "" reach.html planner.html; do
  url="$SITE/$page"
  code=$(curl -sSL -o /dev/null -w '%{http_code}' --max-time 60 "$url" 2>/dev/null)
  if [ "$code" != "200" ]; then
    echo "FAIL  ${page:-/} — HTTP $code"
    fail=1
  else
    printf 'ok    %-28s %s\n' "${page:-/}" "$code"
  fi
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "$SITE cannot predict for month $MONTH."
  echo "Run the monthly-rebuild workflow, or rebuild and redeploy by hand."
  exit 1
fi
echo
echo "$SITE can predict for month $MONTH."
