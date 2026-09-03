#!/usr/bin/env bash
# Traegt die IONOS-Zugangsdaten fuer den E-Mail-Versand ein und prueft sie sofort.
#
# Warum ein Skript und kein Eingabefeld im Admin: Das Passwort landet so ausschliesslich
# in der .env (nur fuer den Betriebsnutzer lesbar, nicht in Git, nicht in der Datenbank
# und damit nicht in jeder naechtlichen Sicherung).
#
# Aufruf als deploy (bevorzugt) oder als root:
#   bash /home/deploy/projekte/reifenpro/scripts/mail-zugang.sh
set -u
ENV=/home/deploy/projekte/reifenpro/.env

if [ ! -f "$ENV" ]; then echo "FEHLER: $ENV nicht gefunden."; exit 1; fi
# Die .env gehoert deploy. Als deploy laeuft alles ohne Sonderrechte — das ist der
# vorgesehene Betriebsnutzer. Als root geht es auch, dann werden die Rechte hinterher
# wieder auf deploy zurueckgesetzt.
if [ ! -w "$ENV" ]; then
  echo "FEHLER: Keine Schreibrechte auf $ENV."
  echo "Bitte als Nutzer deploy anmelden:  ssh deploy@161.97.187.239"
  exit 1
fi

echo
echo "E-Mail-Zugang fuer Schroeder & Scholz eintragen"
echo "------------------------------------------------"
read -r -p "E-Mail-Adresse [info@schroeder-scholz.de]: " ADRESSE
ADRESSE=${ADRESSE:-info@schroeder-scholz.de}

# -s: die Eingabe wird nicht angezeigt und landet nicht im Terminalverlauf.
read -r -s -p "Passwort des Postfachs: " PASSWORT
echo
if [ -z "$PASSWORT" ]; then echo "Abgebrochen: kein Passwort eingegeben."; exit 1; fi

SICHERUNG="$ENV.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV" "$SICHERUNG"

ADRESSE="$ADRESSE" PASSWORT="$PASSWORT" python3 - "$ENV" <<'PY'
import os, re, sys
pfad = sys.argv[1]
werte = {
    'SMTP_HOST': 'smtp.ionos.de',
    'SMTP_PORT': '587',
    'SMTP_SECURE': 'false',            # 587 nutzt STARTTLS, nicht implizites TLS
    'SMTP_USER': os.environ['ADRESSE'],
    'SMTP_PASS': os.environ['PASSWORT'],
    'EMAIL_FROM_ADDRESS': os.environ['ADRESSE'],
    'EMAIL_FROM_NAME': 'Schröder & Scholz',
}
zeilen = open(pfad, encoding='utf-8').read().splitlines()
gesehen, aus = set(), []
for z in zeilen:
    m = re.match(r'^([A-Z_]+)=', z)
    if m and m.group(1) in werte:
        aus.append(f"{m.group(1)}={werte[m.group(1)]}")
        gesehen.add(m.group(1))
    else:
        aus.append(z)
for k, v in werte.items():
    if k not in gesehen:
        aus.append(f"{k}={v}")
open(pfad, 'w', encoding='utf-8').write("\n".join(aus) + "\n")
PY

# Rechte sicherstellen: Als root wuerde die Datei sonst root gehoeren und der Dienst
# koennte sie nicht mehr lesen.
if [ "$(id -u)" = "0" ]; then chown deploy:deploy "$ENV"; fi
chmod 600 "$ENV"
unset PASSWORT

echo
echo "Eingetragen (Passwort wird nicht angezeigt):"
grep -E '^(SMTP_HOST|SMTP_PORT|SMTP_USER|EMAIL_FROM_ADDRESS|EMAIL_FROM_NAME)=' "$ENV" | sed 's/^/  /'
echo "  Sicherung der alten Datei: $SICHERUNG"

echo
echo "Dienst neu starten ..."
# Der Dienst laeuft im pm2 von root. Als root geht der Neustart direkt, als deploy nur
# ueber sudo — und das verlangt dort ein Passwort, das es auf diesem Server nicht gibt.
NEUSTART=nein
if [ "$(id -u)" = "0" ]; then
  pm2 restart reifenpro >/dev/null 2>&1 && NEUSTART=ja
else
  sudo -n pm2 restart reifenpro >/dev/null 2>&1 && NEUSTART=ja
fi

if [ "$NEUSTART" = "ja" ]; then
  echo "  neu gestartet"
  sleep 2
else
  # WICHTIG: Ohne Neustart laeuft der Dienst weiter mit den ALTEN Zugangsdaten. Eine
  # Testmail waere dann aussagelos — sie ginge vom alten Absender raus und wuerde einen
  # Erfolg vortaeuschen. Deshalb hier abbrechen statt weiterzumachen.
  echo "  Neustart nicht moeglich (fehlende Rechte als $(whoami))."
  echo
  echo "Die Zugangsdaten sind EINGETRAGEN, aber noch nicht aktiv."
  echo "Bitte einmal ausfuehren:   ssh root@161.97.187.239 'pm2 restart reifenpro'"
  echo "Danach pruefe ich den Versand, oder du startest dieses Skript erneut als root."
  exit 0
fi

echo
echo "Testmail wird an david.gebray@icloud.com geschickt ..."
cd /home/deploy/projekte/reifenpro || exit 1
node -e "
require('dotenv').config();
const nm = require('nodemailer');
const t = nm.createTransport({
  host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
t.verify().then(function () {
  console.log('  Anmeldung beim Mailserver: erfolgreich');
  return t.sendMail({
    from: '\"' + process.env.EMAIL_FROM_NAME + '\" <' + process.env.EMAIL_FROM_ADDRESS + '>',
    to: 'david.gebray@icloud.com',
    subject: 'Testmail vom neuen Absender',
    text: 'Diese Mail kommt von ' + process.env.EMAIL_FROM_ADDRESS + '.\n\n'
        + 'Wenn sie im Posteingang liegt und der Absender stimmt, ist der Versand richtig eingerichtet.\n'
        + 'Bitte auch den Spam-Ordner pruefen.',
  });
}).then(function () {
  console.log('  Testmail versendet.');
  process.exit(0);
}).catch(function (e) {
  console.log('  FEHLGESCHLAGEN: ' + e.message);
  console.log('  Die alte Konfiguration liegt in der Sicherung oben.');
  process.exit(1);
});
"
echo
echo "Fertig. Bitte im Postfach nachsehen — auch im Spam-Ordner."
