#!/usr/bin/env bash
set -euo pipefail
dir=/var/lib/tomilo-host-monitor
date=$(TZ=Europe/Moscow date -d yesterday +%F)
file="$dir/daily-activity.json"
if grep -Fq "\"date\":\"$date\"" "$file" 2>/dev/null; then exit 0; fi
tmp=$(mktemp "$dir/.daily-activity.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
docker exec -i tomilo-docker-api-1 node - "$date" < "$(dirname "$0")/collect-daily-activity.cjs" > "$tmp"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["date"] == sys.argv[2] and all(type(d[k]) is int and d[k]>=0 for k in ("users","chapters","titles","anime","episodes"))' "$tmp" "$date"
chmod 644 "$tmp"
mv -f -- "$tmp" "$file"
