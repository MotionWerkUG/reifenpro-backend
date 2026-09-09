#!/usr/bin/env bash
# Prueft, ob src/db/schema.sql noch der Produktionsdatenbank entspricht.
#
# WARUM: schema.sql ist der einzige Weg, das System aus dem Repository heraus wieder
# aufzubauen. Sie driftet bei jeder Migration ab, und die Abweichung faellt NICHT auf --
# die Anwendung laeuft ja gegen die echte Datenbank. Am 09.09.2026 fehlten in einem Lauf
# die Tabelle widerrufe und vier Spalten, in einem spaeteren erneut eine Spalte.
#
# Baut eine leere Wegwerf-Datenbank aus schema.sql und vergleicht Spalte fuer Spalte.
# Rueckgabe 0 = identisch, 1 = Abweichung (dann schema.sql neu erzeugen).
set -euo pipefail
cd "$(dirname "$0")/.."
PRUEF="reifenpro_schemaabgleich"
QUELLE="${1:-reifenpro}"
case "$PRUEF" in *reifenpro_schemaabgleich) ;; *) echo "Falscher Pruefname"; exit 2 ;; esac

sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS ${PRUEF};"
sudo -u postgres psql -q -c "CREATE DATABASE ${PRUEF};"
if ! sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "${PRUEF}" < src/db/schema.sql > /tmp/schema-abgleich.log 2>&1; then
  echo "FEHLER: schema.sql laeuft nicht durch. Letzte Zeilen:"; tail -10 /tmp/schema-abgleich.log
  sudo -u postgres psql -q -c "DROP DATABASE ${PRUEF};"; exit 1
fi

spalten() { sudo -u postgres psql -tAq -d "$1" -c "SELECT table_name||'.'||column_name||':'||data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY 1"; }
objekte() { sudo -u postgres psql -tAq -d "$1" -c "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')||' Tabellen, '||(SELECT count(*) FROM pg_constraint WHERE contype='f')||' FKs, '||(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)||' Trigger, '||(SELECT count(*) FROM pg_indexes WHERE schemaname='public')||' Indizes'"; }

echo "Produktion:        $(objekte "$QUELLE")"
echo "Aus schema.sql:    $(objekte "$PRUEF")"
if diff <(spalten "$QUELLE") <(spalten "$PRUEF") > /tmp/schema-diff.txt; then
  echo "schema.sql ist auf dem Stand der Produktion."
  sudo -u postgres psql -q -c "DROP DATABASE ${PRUEF};"
  exit 0
else
  echo "ABWEICHUNG -- schema.sql muss neu erzeugt werden:"
  sed 's/^</  fehlt in schema.sql: /; s/^>/  zuviel in schema.sql: /' /tmp/schema-diff.txt | grep -E 'fehlt|zuviel'
  sudo -u postgres psql -q -c "DROP DATABASE ${PRUEF};"
  exit 1
fi
