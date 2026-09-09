#!/bin/bash
# Vollpruefung aller heute geaenderten Funktionen gegen die LAUFENDE Produktion.
cd /home/deploy/projekte/reifenpro
OK=0; FEHL=0
p() { if [ "$2" = "$3" ]; then printf "  ok    %-58s %s\n" "$1" "$2"; OK=$((OK+1)); else printf "  FEHL  %-58s ist=%s soll=%s\n" "$1" "$2" "$3"; FEHL=$((FEHL+1)); fi }
code() { curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$@"; }

echo "═══ 1. Oeffentliche Seiten und Widerrufsknopf ═══"
for u in "https://www.schroeder-scholz.de/" "https://www.schroeder-scholz.de/termin/" "https://www.schroeder-scholz.de/preise/" "https://www.schroeder-scholz.de/portal/" "https://www.schroeder-scholz.de/portal/widerruf.html" "https://www.schroeder-scholz.de/portal/vertrag-widerrufen.html"; do
  p "erreichbar: ${u#https://www.schroeder-scholz.de}" "$(code "$u")" "200"
done
for u in "/" "/termin/" "/preise/" "/portal/" "/portal/widerruf.html"; do
  n=$(curl -s --max-time 15 "https://www.schroeder-scholz.de$u" | grep -c "vertrag-widerrufen")
  p "Widerrufsknopf vorhanden: $u" "$n" "1"
done
p "unbekannte Adresse -> 404" "$(code https://www.schroeder-scholz.de/gibtesnicht)" "404"

echo
echo "═══ 2. Widerrufsfunktion (§ 356a BGB) ═══"
p "ohne Angaben -> 400" "$(code -X POST https://www.schroeder-scholz.de/api/widerrufe -H 'Content-Type: application/json' -d '{}')" "400"
p "kaputte E-Mail -> 400" "$(code -X POST https://www.schroeder-scholz.de/api/widerrufe -H 'Content-Type: application/json' -d '{"name":"A","vertrag":"B","email":"keine"}')" "400"
V=$(sudo -u postgres psql -d reifenpro -t -A -c "SELECT count(*) FROM widerrufe")
curl -s -o /dev/null --max-time 15 -X POST https://www.schroeder-scholz.de/api/widerrufe -H 'Content-Type: application/json' -d '{"name":"Bot","vertrag":"x","email":"b@b.de","website":"spam"}'
p "Honeypot speichert nichts" "$(sudo -u postgres psql -d reifenpro -t -A -c 'SELECT count(*) FROM widerrufe')" "$V"

echo
echo "═══ 3. Zustimmung zum vorzeitigen Leistungsbeginn ═══"
p "Token-Format falsch -> 400" "$(code 'https://www.schroeder-scholz.de/api/zustimmung/bestaetigen?token=abc')" "400"
p "unbekanntes Token -> 404" "$(code "https://www.schroeder-scholz.de/api/zustimmung/bestaetigen?token=$(python3 -c 'import secrets;print(secrets.token_hex(32))')")" "404"
p "anfordern ohne Anmeldung -> 401" "$(code -X POST https://admin.schroeder-scholz.de/api/zustimmung/anfordern/00000000-0000-0000-0000-000000000000)" "401"

echo
echo "═══ 4. Rechte der Rolle Werkstatt ═══"
T=$(curl -s --max-time 10 -X POST https://admin.schroeder-scholz.de/api/auth/login -H 'Content-Type: application/json' -d '{"email":"werkstatt-test@intern.local","passwort":"WerkstattTest2026!"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))")
p "Anmeldung Werkstatt" "$([ -n "$T" ] && echo ja || echo nein)" "ja"
p "Termine lesen -> 200" "$(code https://admin.schroeder-scholz.de/api/termine -H "Authorization: Bearer $T")" "200"
p "Kunden lesen -> 200" "$(code https://admin.schroeder-scholz.de/api/kunden -H "Authorization: Bearer $T")" "200"
p "Kunden anlegen -> 403" "$(code -X POST https://admin.schroeder-scholz.de/api/kunden -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"vorname":"x","nachname":"y","telefon":"1"}')" "403"
p "Einstellungen -> 403" "$(code https://admin.schroeder-scholz.de/api/einstellungen -H "Authorization: Bearer $T")" "403"
p "Rechnungen -> 403" "$(code https://admin.schroeder-scholz.de/api/rechnungen -H "Authorization: Bearer $T")" "403"
p "Widerrufe -> 403" "$(code https://admin.schroeder-scholz.de/api/widerrufe -H "Authorization: Bearer $T")" "403"
p "Benutzerverwaltung -> 403" "$(code https://admin.schroeder-scholz.de/api/users -H "Authorization: Bearer $T")" "403"

echo
echo "═══ 5. Datenbank: Struktur und Riegel ═══"
p "schema.sql kennt widerrufe" "$(grep -c 'CREATE TABLE public.widerrufe' src/db/schema.sql)" "1"
p "schema.sql kennt vereinbart_ueber" "$(grep -c 'vereinbart_ueber' src/db/schema.sql | head -1 | awk '{print ($1>0)?1:0}')" "1"
p "schema.sql kennt erstzulassung_genauigkeit" "$(grep -c 'erstzulassung_genauigkeit' src/db/schema.sql | awk '{print ($1>0)?1:0}')" "1"
p "Rechte auf widerrufe fuer die Anwendung" "$(sudo -u postgres psql -d reifenpro -t -A -c "SELECT count(DISTINCT privilege_type) FROM information_schema.role_table_grants WHERE table_name='widerrufe' AND grantee='reifenpro_user'")" "4"
p "Spalte baujahr ist entfernt" "$(sudo -u postgres psql -d reifenpro -t -A -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='baujahr'")" "0"
p "kein Kunde ohne Fahrzeugsatz mit Stammkennzeichen" "$(sudo -u postgres psql -d reifenpro -t -A -c "SELECT count(*) FROM kunden k WHERE k.kennzeichen IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fahrzeuge f WHERE f.kunden_id=k.id)")" "0"
p "schema.sql deckt sich mit der Produktion" "$(bash scripts/schema-abgleich.sh >/dev/null 2>&1 && echo ja || echo nein)" "ja"

echo
echo "═══ 6. Oberflaechen: Syntax, Doppler, Auslieferung ═══"
python3 scripts/doppelte-schluessel.py frontend/index.html frontend/portal/index.html frontend/termin/index.html frontend/preise/index.html frontend/portal/vertrag-widerrufen.html > /tmp/claude-0/dk.log 2>&1
p "keine doppelten Schluessel / Sprachluecken" "$?" "0"
for f in "frontend/index.html:/var/www/reifenpro/index.html" "frontend/termin/index.html:/var/www/schroeder-homepage/termin/index.html" "frontend/preise/index.html:/var/www/schroeder-homepage/preise/index.html" "frontend/portal/index.html:/var/www/reifenpro/portal/index.html" "frontend/portal/vertrag-widerrufen.html:/var/www/reifenpro/portal/vertrag-widerrufen.html" "frontend/portal/widerruf.html:/var/www/reifenpro/portal/widerruf.html"; do
  q="${f%%:*}"; z="${f##*:}"
  p "ausgeliefert = Arbeitsstand: $(basename $(dirname $q))/$(basename $q)" "$(diff -q "$q" "$z" >/dev/null 2>&1 && echo gleich || echo abweichend)" "gleich"
done

echo
echo "═══ 7. Rechtstexte: richtiger Paragraf ═══"
p "keine Fundstelle 356 Abs. 4 mehr" "$(grep -rc '356 Abs. 4' --include=*.js --include=*.html src/ frontend/ 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')" "0"
p "Erlöschen zitiert Abs. 5 Nr. 2" "$(grep -rl '356 Abs. 5 Nr. 2' --include=*.js --include=*.html src/ frontend/ | wc -l | awk '{print ($1>=5)?1:0}')" "1"

echo
echo "═══ 8. Betrieb ═══"
p "Prozess laeuft" "$(sudo pm2 jlist 2>/dev/null | python3 -c "import json,sys;print([p['pm2_env']['status'] for p in json.load(sys.stdin) if p['name']=='reifenpro'][0])")" "online"
p "sandumotion unberuehrt" "$(sudo pm2 jlist 2>/dev/null | python3 -c "import json,sys;print([p['pm2_env']['status'] for p in json.load(sys.stdin) if p['name']=='sandumotion'][0])")" "online"
p "nichts Uncommittetes ausser CLAUDE.md" "$(git status --short | grep -v 'CLAUDE.md' | wc -l)" "0"

echo
echo "───────────────────────────────────────────────"
echo "  $OK bestanden, $FEHL fehlgeschlagen"
[ $FEHL -eq 0 ] || exit 1
