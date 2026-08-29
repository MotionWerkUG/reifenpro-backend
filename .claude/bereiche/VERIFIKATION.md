# Verifikation im Browser (ohne Passwort-Tippen, ohne echte Daten)

So bestätigst du Änderungen real (Firmenprinzip: nichts unverifiziert als „behoben" melden),
ohne echte Kundendaten anzufassen. Browser: bevorzugt die Chrome-Erweiterung
(`mcp__claude-in-chrome__*`); ist keine verbunden, headless mit Playwright
(`npm install --no-save playwright`, danach wieder entfernen).

## 0. Bevorzugt: isolierte QA-Umgebung statt Prod (Stand 2026-08-28)

Es gibt kein Staging. Alles, was Daten aendert oder Mails ausloest (Loeschung, Statuswechsel,
Letzter-Admin-Sperre, Upload-Limits), gehoert NICHT auf die Live-Datenbank. Stattdessen:

- DB-Kopie: `sudo -u postgres createdb -O reifenpro_user reifenpro_qa` und
  `sudo -u postgres pg_dump -s reifenpro | sudo -u postgres psql -d reifenpro_qa`
  (pipen — postgres kann Dateien im root-Scratchpad nicht lesen). Konfigtabellen per
  `pg_dump --data-only --table=…` nachziehen (einstellungen, artikel, artikel_preise,
  buchung_leistungen, oeffnungszeiten, lager_config, lager_orte, lager_regale).
- Zweite Instanz: `.env` kopieren, darin PORT, `DB_NAME=reifenpro_qa`,
  `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1` (Mailversuche laufen ins Leere und werden im Code
  abgefangen) und `BACKUP_DIR` umbiegen. Starter laedt `dotenv.config({path: qa.env})` und
  dann `src/server.js`; dotenv ueberschreibt gesetzte Werte nicht.
- Oberflaeche: kleiner Static-Server, der `frontend/` ausliefert und `/api/*` auf die
  QA-Instanz weiterreicht — damit funktioniert der echte Login im Browser.
- Achtung: NIE `pkill -f <skriptname>` (trifft die eigene Kommandozeile und killt die Shell);
  PID-Datei schreiben. Am Ende `sudo -u postgres dropdb reifenpro_qa`, Instanzen beenden und
  Testdateien aus `gewerbe-dokumente/` und `protokoll-dateien/` loeschen.

## 1. Kurzlebiges Testkonto anlegen (nur wenn es Prod sein MUSS)

Laeuft im aktiven Projektverzeichnis `/home/deploy/projekte/reifenpro` (NICHT im inaktiven
Alt-Ordner `/var/www/reifenpro-backend`), damit `pg`-Konfiguration und `bcryptjs` stimmen.
Passwort-Hash mit `bcryptjs` (rounds 12) erzeugen, Benutzer per SQL anlegen, Kunde mit
`kunden_nr` nach dem Muster `K-TEST-%` (spaeter gezielt loeschbar). Kein echter Kundenname,
keine echte Adresse, keine echte E-Mail-Domain.

## 2. Echten Token ueber die Login-API holen (garantiert korrekte Form)

```bash
curl -s -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"qa-admin@qatest.example","passwort":"..."}'
```
Portal analog ueber `/api/portal/auth/login`. Aus der Antwort das Feld `token` nehmen.

## 3. Token injizieren + App booten (im In-App-Browser)
Admin/CMS localStorage-Key: `rp_token` · Portal-Key: `rp_portal_token`.
- Seite mit Cache-Buster laden (`?cb=…`), Token in `localStorage` setzen, dann frisch navigieren und ~2 s warten.
- Der Init-Auth-Check läuft einmal beim Laden; wenn er race’t, App per JS booten:
  `TOKEN=localStorage.getItem('rp_token'); fetch(API+'/auth/me',{headers:{Authorization:'Bearer '+TOKEN}}).then(r=>r.json()).then(j=>{USER=j.user; startApp();})`
- DOM-Prüfungen sind zuverlässiger als abgeschnittene Screenshots (Viewport 1280, Screenshot 800): z. B. gerenderte Buttons per `document.querySelectorAll` zählen.
- Backend-Verhalten direkt per `curl` mit dem Token testen (z. B. Strip: `<b>xss</b>` → `bxss/b`).

## 4. Aufräumen (Pflicht — Produktionszustand wiederherstellen)
`audit_log` referenziert `users` per FK (Audit-Fund S5): den User-Delete ggf. erst nach dem audit_log-Delete.
```bash
sudo -u postgres psql -d reifenpro <<'SQL'
DELETE FROM kunden WHERE portal_email='qa-kunde@qatest.example' OR kunden_nr='K-9990';
DELETE FROM audit_log WHERE user_id=(SELECT id FROM users WHERE email='qa-admin@qatest.example');
DELETE FROM users WHERE email='qa-admin@qatest.example';
SQL
```
Danach prüfen, dass 0 Reste bleiben. Token-Dateien aus dem Scratchpad löschen.
