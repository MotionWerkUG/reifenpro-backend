#!/usr/bin/env bash
# SessionStart-Hook: haelt in einer gemeinsamen Registry fest, welche Session (session_id)
# gerade in welchem BEREICH (= Worktree) aktiv ist. Der oeffentliche Peer-Name (z.B.
# reifenpro-92) ist im Hook NICHT verfuegbar (Claude-Code-Einschraenkung); er wird nach
# Konvention aus dem Bereich abgeleitet (feste Namen reifenpro-<bereich>) bzw. von der
# Session selbst via ListAgents nachgetragen. Laeuft fail-soft, blockiert nie den Start.
REG="/home/deploy/projekte/reifenpro/.claude/session-registry.json"
LOCK="$REG.lock"
input="$(cat 2>/dev/null)"
command -v jq >/dev/null 2>&1 || exit 0
sid="$(printf '%s' "$input" | jq -r '.session_id // "?"' 2>/dev/null)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // "?"' 2>/dev/null)"
src="$(printf '%s' "$input" | jq -r '.source // ""' 2>/dev/null)"
base="$(basename "$cwd" 2>/dev/null)"
case "$base" in
  reifenpro)    area="main" ;;
  reifenpro-*)  area="${base#reifenpro-}" ;;
  *)            area="$base" ;;
esac
ts="$(date -Iseconds 2>/dev/null)"
mkdir -p "$(dirname "$REG")" 2>/dev/null
exec 9>"$LOCK" 2>/dev/null || exit 0
flock -w 5 9 2>/dev/null || exit 0
[ -s "$REG" ] || printf '{"areas":{}}' > "$REG"
tmp="$(mktemp 2>/dev/null)" || exit 0
if jq --arg a "$area" --arg s "$sid" --arg c "$cwd" --arg t "$ts" --arg src "$src" \
     '.areas[$a]={session_id:$s,cwd:$c,gestartet:$t,source:$src,status:"aktiv"}' \
     "$REG" > "$tmp" 2>/dev/null; then
  mv "$tmp" "$REG" 2>/dev/null
else
  rm -f "$tmp" 2>/dev/null
fi
exit 0
