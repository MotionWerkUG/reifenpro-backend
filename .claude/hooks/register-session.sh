#!/usr/bin/env bash
# SessionStart-Hook: haelt in einer gemeinsamen Registry fest, welche Session (session_id)
# gerade in welchem BEREICH (= Worktree) aktiv ist, UND warnt, wenn im selben Worktree
# bereits eine andere Session laeuft. Der oeffentliche Peer-Name (z.B. admin-1e) ist im
# Hook NICHT verfuegbar (Claude-Code-Einschraenkung) und wechselt ohnehin bei jedem Start —
# darum wird zusaetzlich die PID des Sitzungsprozesses gespeichert. Nur damit laesst sich
# spaeter pruefen, ob ein Registry-Eintrag noch lebt oder eine Leiche ist.
# Laeuft fail-soft und blockiert den Start nie.
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

# Eigene Sitzungs-PID suchen: vom Hook aus nach oben laufen, bis der Claude-Prozess kommt.
# Fallback ist der direkte Elternprozess — lieber eine unscharfe PID als gar keine.
eigene_pid="$PPID"
p="$PPID"
for _ in 1 2 3 4 5 6; do
  [ -z "$p" ] || [ "$p" = "1" ] && break
  argv0="$(tr '\0' '\n' < "/proc/$p/cmdline" 2>/dev/null | head -1)"
  case "$argv0" in
    *ccd-cli*|*/claude|claude) eigene_pid="$p"; break ;;
  esac
  p="$(awk '{print $4}' "/proc/$p/stat" 2>/dev/null)"
done

mkdir -p "$(dirname "$REG")" 2>/dev/null
exec 9>"$LOCK" 2>/dev/null || exit 0
flock -w 5 9 2>/dev/null || exit 0
[ -s "$REG" ] || printf '{"areas":{}}' > "$REG"

# Doppelbelegung erkennen: Steht fuer diesen Bereich schon eine ANDERE Session drin und
# laeuft deren Prozess noch, dann arbeiten zwei Sessions in denselben Dateien. Das faellt
# sonst erst nach Stunden auf (zwei Staende, die sich gegenseitig ueberschreiben).
alt_sid="$(jq -r --arg a "$area" '.areas[$a].session_id // ""' "$REG" 2>/dev/null)"
alt_pid="$(jq -r --arg a "$area" '.areas[$a].pid // ""' "$REG" 2>/dev/null)"
alt_start="$(jq -r --arg a "$area" '.areas[$a].gestartet // ""' "$REG" 2>/dev/null)"
alt_status="$(jq -r --arg a "$area" '.areas[$a].status // ""' "$REG" 2>/dev/null)"
if [ -n "$alt_sid" ] && [ "$alt_sid" != "$sid" ] && [ "$alt_status" = "aktiv" ] &&
   [ -n "$alt_pid" ] && [ "$alt_pid" != "null" ] && kill -0 "$alt_pid" 2>/dev/null; then
  alt_alter="$(ps -p "$alt_pid" -o etime= 2>/dev/null | tr -d ' ')"
  cat <<WARN
ACHTUNG — DOPPELBELEGUNG IM WORKTREE $cwd

Im Bereich "$area" laeuft bereits eine andere Session:
  PID $alt_pid, laeuft seit $alt_alter, gestartet $alt_start, session_id $alt_sid

Beide Sessions schreiben in DIESELBEN Dateien — Worktrees trennen Bereiche, nicht Prozesse.
Bevor du irgendetwas aenderst:
1. Frage die andere Session per SendMessage, ob sie noch arbeitet und was sie uncommittet hat.
2. Klaere mit David, welche Session bleibt. Die andere haelt an (keine Datei-/git-Aenderungen).
3. Erst danach weiterarbeiten. Nicht parallel committen oder nach main mergen.

Ist die andere Session nur eine Leiche (Fenster geschlossen, Prozess laeuft weiter), sagt
David Bescheid — beendet wird sie nur nach ausdruecklicher Freigabe.
WARN
fi

tmp="$(mktemp 2>/dev/null)" || exit 0
if jq --arg a "$area" --arg s "$sid" --arg c "$cwd" --arg t "$ts" --arg src "$src" --arg p "$eigene_pid" \
     '.areas[$a]={session_id:$s,cwd:$c,pid:($p|tonumber? // null),gestartet:$t,source:$src,status:"aktiv"}' \
     "$REG" > "$tmp" 2>/dev/null; then
  mv "$tmp" "$REG" 2>/dev/null
else
  rm -f "$tmp" 2>/dev/null
fi
exit 0
