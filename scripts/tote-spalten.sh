#!/usr/bin/env bash
# Findet Datenbankspalten, die im Code NIRGENDS vorkommen.
#
# WARUM: Der Inhaber hat am 09.09.2026 gefragt: "Ich höre immer neue Spalten, neue Spalten.
# Kontrolliert, ob ich irgendetwas Unnötiges anlege oder ob ich langsam einen Riesendatenmüll
# verursache." Die Frage verdient eine Messung, keine Rechtfertigung -- und sie wird wiederkommen.
#
# ZWEI FALLEN, an denen erste Versuche gescheitert sind:
#   1. Zu wenige Ordner durchsuchen. Die halbe Anwendung steht in frontend/*.html, und die
#      zeitgesteuerten Auftraege liegen als cron-erinnerungen.js im PROJEKTWURZELVERZEICHNIS.
#      Wer nur src/ durchsucht, haelt portal_verifiziert faelschlich fuer tot; wer src/ und
#      frontend/ durchsucht, haelt erinnerung_gesendet und bewertung_gesendet faelschlich fuer
#      tot. Beides ist am 09.09.2026 passiert -- der zweite Fall diesem Skript selbst, beim
#      allerersten Lauf.
#   2. Ohne Wortgrenze suchen. "id", "status" oder "typ" kommen in jedem zweiten Wort vor und
#      liefern immer einen Treffer, also nie einen Befund.
#
# Der Befund ist ein HINWEIS, kein Urteil: Eine Spalte kann ueber dynamischen Zugriff
# (row[name], SELECT *) benutzt werden, ohne dass ihr Name im Code steht. Vor dem Loeschen
# immer selbst nachsehen -- und den Loeschbefehl bekommt der Inhaber vorgelegt, nicht ausgefuehrt.
#
# Aufruf:  bash scripts/tote-spalten.sh [tabelle]
# Rueckgabe: 0 = nichts gefunden, 1 = Verdachtsfaelle, 2 = Selbstpruefung fehlgeschlagen
set -uo pipefail
cd "$(dirname "$0")/.."
DB="${DB_NAME:-reifenpro}"
NUR="${1:-}"

# Durchsucht src/, frontend/ UND die .js-Dateien im Projektwurzelverzeichnis (dort liegen die
# zeitgesteuerten Auftraege). Die Worktrees der anderen Bereiche bleiben aussen vor -- sie sind
# Kopien und wuerden jede Spalte am Leben halten, auch eine wirklich tote.
suche() {
  grep -rqw "$1" --include=*.js --include=*.html src/ frontend/ 2>/dev/null && return 0
  grep -qw "$1" ./*.js 2>/dev/null
}

# ── Selbstpruefung: Das Werkzeug muss an einem BEKANNTEN Fall anschlagen ───────────────────────
# Ohne sie hiesse "keine Funde" womoeglich nur, dass die Suche nicht funktioniert.
if suche "diese_spalte_gibt_es_garantiert_nicht_xyz"; then
  echo "SELBSTPRUEFUNG FEHLGESCHLAGEN: Die Suche meldet einen Treffer fuer einen erfundenen Namen." >&2
  exit 2
fi
# Zweiter Selbsttest, genau fuer die Falle von oben: erinnerung_gesendet steht AUSSCHLIESSLICH
# in cron-erinnerungen.js im Wurzelverzeichnis. Findet die Suche es nicht, durchsucht sie zu
# wenig -- und meldet dann tote Spalten, die quicklebendig sind.
if ! suche "erinnerung_gesendet"; then
  echo "SELBSTPRUEFUNG FEHLGESCHLAGEN: 'erinnerung_gesendet' wird nicht gefunden, obwohl es in" >&2
  echo "cron-erinnerungen.js steht. Die Suche deckt zu wenige Ordner ab." >&2
  exit 2
fi
if ! suche "kunden_nr"; then
  echo "SELBSTPRUEFUNG FEHLGESCHLAGEN: Die Suche findet 'kunden_nr' nicht, obwohl es im Code steht." >&2
  echo "Ein 'keine Funde' waere hier wertlos." >&2
  exit 2
fi

# Spalten, die per Bauart nie namentlich im Code stehen muessen.
TECHNISCH="id erstellt_am geaendert_am erstellt_von geaendert_von"

gefunden=0
TABELLEN=$(sudo -u postgres psql -tAq -d "$DB" -c \
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ${NUR:+AND tablename='$NUR'} ORDER BY 1")

for t in $TABELLEN; do
  treffer=""
  for s in $(sudo -u postgres psql -tAq -d "$DB" -c \
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='$t'"); do
    case " $TECHNISCH " in *" $s "*) continue ;; esac
    suche "$s" || treffer="$treffer $s"
  done
  if [ -n "$treffer" ]; then
    echo "$t:"
    for s in $treffer; do
      z=$(sudo -u postgres psql -tAq -d "$DB" -c "SELECT count(*) FROM $t WHERE $s IS NOT NULL" 2>/dev/null || echo "?")
      echo "    $s   (gefuellte Zeilen: $z)"
    done
    gefunden=1
  fi
done

if [ "$gefunden" -eq 0 ]; then
  echo "Keine Spalte ohne Fundstelle im Code."
else
  echo
  echo "Hinweis, kein Urteil: Vor dem Loeschen pruefen, ob die Spalte ueber dynamischen Zugriff"
  echo "(row[name], SELECT *) benutzt wird. Der Loeschbefehl gehoert dem Inhaber vorgelegt."
fi
exit $gefunden
