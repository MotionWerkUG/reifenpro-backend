#!/usr/bin/env bash
# Legt die Test-Datenbank (Standard: reifenpro_test) NEU an — Schema 1:1 aus der
# Produktivdatenbank (pg_dump --schema-only), aber OHNE Daten. So laufen die Tests
# gegen genau das Schema, das auch produktiv gilt (inkl. GoBD-Schutz-Trigger),
# ohne echte Belege oder den produktiven Nummernkreis zu beruehren.
#
# Aufruf:  npm run test:db
# Braucht: sudo-Rechte fuer den Postgres-Superuser (wie im Projekt ueblich).
set -euo pipefail

cd "$(dirname "$0")/.."

# .env NICHT sourcen (enthaelt unquotete Werte mit Leerzeichen) — nur die noetigen Keys lesen.
envwert() { sed -n "s/^[[:space:]]*$1=//p" .env | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }

SRC_DB="${DB_NAME:-$(envwert DB_NAME)}"
TEST_DB="${TEST_DB_NAME:-reifenpro_test}"
APP_USER="${DB_USER:-$(envwert DB_USER)}"
SRC_DB="${SRC_DB:-reifenpro}"
APP_USER="${APP_USER:-reifenpro_user}"

# Schutz: die Produktivdatenbank darf NIEMALS Ziel dieses Skripts sein.
if [ "$TEST_DB" = "$SRC_DB" ]; then
  echo "FEHLER: TEST_DB_NAME ist identisch mit der Produktivdatenbank ($SRC_DB). Abbruch." >&2
  exit 1
fi
case "$TEST_DB" in
  *test*) ;;
  *) echo "FEHLER: Test-Datenbankname muss 'test' enthalten (ist: $TEST_DB). Abbruch." >&2; exit 1 ;;
esac

echo "[Test-DB] Erzeuge $TEST_DB aus dem Schema von $SRC_DB ..."
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS ${TEST_DB};"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE ${TEST_DB} OWNER ${APP_USER};"
sudo -u postgres pg_dump --schema-only "${SRC_DB}" \
  | sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" > /dev/null

# Noch nicht produktiv ausgefuehrte Migrationen nachziehen. Das Schema stammt aus der
# Produktivdatenbank; liegt im Projekt eine Migration, die dort noch nicht gelaufen ist,
# wuerden die Tests sonst gegen ein aelteres Schema laufen als der Code erwartet.
# Die Dateien sind nach Projektkonvention mehrfach ausfuehrbar (IF NOT EXISTS).
for f in migration-*.sql; do
  [ -e "$f" ] || continue
  if ! sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" -f "$f" > /dev/null 2>&1; then
    echo "[Test-DB] Hinweis: $f liess sich nicht anwenden (uebersprungen)." >&2
  fi
done

# Die Objekte gehoeren nach dem Restore dem Superuser -> Anwendungsnutzer berechtigen.
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "${TEST_DB}" <<SQL
GRANT USAGE, CREATE ON SCHEMA public TO ${APP_USER};
GRANT ALL ON ALL TABLES IN SCHEMA public TO ${APP_USER};
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${APP_USER};
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO ${APP_USER};
SQL

echo "[Test-DB] Fertig: ${TEST_DB} (leer, Schema wie produktiv)."
