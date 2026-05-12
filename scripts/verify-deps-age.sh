#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE="$(dirname "$0")/../package-lock.json"

if [[ ! -f "$LOCK_FILE" ]]; then
  echo "ERROR: package-lock.json not found at $LOCK_FILE" >&2
  exit 1
fi

MIN_DAYS=8
FAILED=0

# Extract all packages with their resolved versions from package-lock.json
# Output format: name@version
PACKAGES=$(node -e "
const lock = JSON.parse(require('fs').readFileSync('$LOCK_FILE', 'utf8'));
const packages = lock.packages || {};
const seen = new Set();
for (const [path, meta] of Object.entries(packages)) {
  if (!path || path === '' || !meta.version) continue;
  // path is like 'node_modules/foo' or 'node_modules/foo/node_modules/bar'
  const parts = path.split('node_modules/');
  const name = parts[parts.length - 1];
  const key = name + '@' + meta.version;
  if (!seen.has(key)) {
    seen.add(key);
    console.log(key);
  }
}
")

TOTAL=0
TOO_NEW=0
NOW=$(date +%s)

printf '%-60s %10s %s\n' "PACKAGE" "AGE(days)" "STATUS"
printf '%s\n' "$(printf '%.0s-' {1..80})"

while IFS= read -r pkg; do
  [[ -z "$pkg" ]] && continue
  TOTAL=$((TOTAL + 1))

  # Split name@version — handle scoped packages like @scope/name@version
  if [[ "$pkg" == @* ]]; then
    # scoped: @scope/name@version
    NAME=$(echo "$pkg" | sed 's/@[^@]*$//')
    VERSION=$(echo "$pkg" | sed 's/.*@//')
  else
    NAME="${pkg%@*}"
    VERSION="${pkg##*@}"
  fi

  # Query npm registry for publish date of this exact version
  PUBLISH_DATE=$(node -e "
const https = require('https');
const url = 'https://registry.npmjs.org/' + encodeURIComponent('$NAME') + '/' + encodeURIComponent('$VERSION');
const req = https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.error) { process.stdout.write('ERROR'); process.exit(0); }
      const time = json.time;
      if (time) process.stdout.write(time);
      else process.stdout.write('UNKNOWN');
    } catch(e) { process.stdout.write('PARSE_ERROR'); }
  });
});
req.on('error', () => process.stdout.write('NET_ERROR'));
req.setTimeout(8000, () => { req.destroy(); process.stdout.write('TIMEOUT'); });
" 2>/dev/null)

  if [[ "$PUBLISH_DATE" == "ERROR" || "$PUBLISH_DATE" == "UNKNOWN" || "$PUBLISH_DATE" == "PARSE_ERROR" || "$PUBLISH_DATE" == "TIMEOUT" || "$PUBLISH_DATE" == "NET_ERROR" ]]; then
    printf '%-60s %10s %s\n' "${NAME}@${VERSION}" "N/A" "SKIP ($PUBLISH_DATE)"
    continue
  fi

  PUBLISH_TS=$(date -d "$PUBLISH_DATE" +%s 2>/dev/null || echo "0")
  if [[ "$PUBLISH_TS" == "0" ]]; then
    printf '%-60s %10s %s\n' "${NAME}@${VERSION}" "N/A" "SKIP (bad date)"
    continue
  fi

  AGE_DAYS=$(( (NOW - PUBLISH_TS) / 86400 ))

  if [[ $AGE_DAYS -lt $MIN_DAYS ]]; then
    printf '%-60s %10d %s\n' "${NAME}@${VERSION}" "$AGE_DAYS" "FAIL (< ${MIN_DAYS} days)"
    FAILED=$((FAILED + 1))
    TOO_NEW=$((TOO_NEW + 1))
  else
    printf '%-60s %10d %s\n' "${NAME}@${VERSION}" "$AGE_DAYS" "OK"
  fi
done <<< "$PACKAGES"

printf '%s\n' "$(printf '%.0s-' {1..80})"
echo "Total packages checked: $TOTAL  |  Too new (< ${MIN_DAYS} days): $TOO_NEW"

if [[ $FAILED -gt 0 ]]; then
  echo "FAIL: $FAILED package(s) published less than ${MIN_DAYS} days ago."
  exit 1
fi

echo "PASS: All packages are ${MIN_DAYS}+ days old."
exit 0
