#!/usr/bin/env bash
# Loescht unsere Protokolldateien nach ALTER, nicht nach Stueckzahl.
#
# WARUM: Die Datenschutzerklaerung verspricht, Protokolle "spaetestens nach 15 Tagen" zu
# loeschen. Gehalten wurde das bisher nur durch Zufall: logrotate (nginx) und pm2-logrotate
# behalten 14 DATEIEN und ueberspringen Tage, an denen nichts geschrieben wurde. Am 09.09.2026
# gemessen: Die Fehlerprotokolle reichten deshalb bis zum 08.07. zurueck -- gut zwei Monate.
# Sie enthielten zwar nichts Personenbezogenes, aber die Zusage darf nicht am Besucheraufkommen
# haengen. Ein ruhiges Wochenende vor der Eroeffnung genuegt, und sie stimmt nicht mehr.
#
# BEWUSST ENG GEFASST: Angefasst werden NUR die Protokolle dieses Projekts. Im selben
# Verzeichnis liegen die Protokolle anderer Projekte (u. a. sandumotion) -- die gehen uns
# nichts an. Deshalb keine Aenderung an /etc/logrotate.d/nginx, die alle Seiten des Servers
# treffen wuerde, sondern diese eigene, abgegrenzte Zeile.
#
# Das aktuelle, noch beschriebene Protokoll bleibt immer stehen (nur *.1, *.gz, *__DATUM.log).
#
# Aufruf ohne Argument loescht; "--probe" zeigt nur an, was faellig waere.
set -uo pipefail
TAGE=15
PROBE=0
[ "${1:-}" = "--probe" ] && PROBE=1

faellig() {
  # $1 Verzeichnis, $2 Muster -- nur ROTIERTE Dateien, nie das laufende Protokoll
  find "$1" -maxdepth 1 -type f -name "$2" -mtime "+$TAGE" 2>/dev/null
}

LISTE=$(
  faellig /var/log/nginx 'schroeder-scholz.access.log.*'
  faellig /var/log/nginx 'schroeder-scholz.error.log.*'
  faellig /root/.pm2/logs 'reifenpro-out__*.log*'
  faellig /root/.pm2/logs 'reifenpro-error__*.log*'
)

if [ -z "$LISTE" ]; then
  [ "$PROBE" -eq 1 ] && echo "Nichts aelter als $TAGE Tage."
  exit 0
fi

if [ "$PROBE" -eq 1 ]; then
  echo "Waere faellig (aelter als $TAGE Tage):"
  echo "$LISTE" | while read -r f; do [ -n "$f" ] && echo "  $(date -r "$f" +%d.%m.%Y)  $f"; done
  exit 0
fi

echo "$LISTE" | while read -r f; do
  [ -n "$f" ] || continue
  rm -f -- "$f" && logger -t reifenpro-protokolle "geloescht (aelter als $TAGE Tage): $f"
done
