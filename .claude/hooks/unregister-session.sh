#!/usr/bin/env bash
# SessionEnd-Hook: markiert die eigene Session in der Registry als beendet. Ueberschreibt
# NUR den eigenen Eintrag (per session_id) — hat inzwischen eine neue Session den Bereich
# uebernommen, bleibt deren Eintrag unangetastet. Fail-soft.
REG="/home/deploy/projekte/reifenpro/.claude/session-registry.json"
LOCK="$REG.lock"
[ -f "$REG" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
input="$(cat 2>/dev/null)"
sid="$(printf '%s' "$input" | jq -r '.session_id // "?"' 2>/dev/null)"
ts="$(date -Iseconds 2>/dev/null)"
exec 9>"$LOCK" 2>/dev/null || exit 0
flock -w 5 9 2>/dev/null || exit 0
tmp="$(mktemp 2>/dev/null)" || exit 0
if jq --arg s "$sid" --arg t "$ts" \
     '.areas |= with_entries(if .value.session_id==$s then (.value.status="beendet" | .value.beendet=$t) else . end)' \
     "$REG" > "$tmp" 2>/dev/null; then
  mv "$tmp" "$REG" 2>/dev/null
else
  rm -f "$tmp" 2>/dev/null
fi
exit 0
