# Verifikation im Browser (ohne Passwort-Tippen, ohne echte Daten)

So bestätigst du Änderungen real (Firmenprinzip: nichts unverifiziert als „behoben" melden),
ohne echte Kundendaten anzufassen. In-App-Browser (`mcp__Claude_Browser__*`) verwenden.

## 1. Kurzlebiges Testkonto anlegen (auf dem Server, über das DB-Modul der App)
Läuft im App-Verzeichnis, damit `pg`-Konfiguration und `bcryptjs` stimmen:

```bash
ssh root@161.97.187.239 'cd /var/www/reifenpro-backend && node -e "
require(\"dotenv\").config();
const bcrypt=require(\"bcryptjs\"); const db=require(\"./src/db/index\");
(async()=>{
  const h=await bcrypt.hash(\"QaTest1234!\",12);
  // Mitarbeiter (fuer Admin/CMS)
  await db.query(\"DELETE FROM users WHERE email=\$1\",[\"qa-admin@qatest.example\"]);
  const u=await db.query(\"INSERT INTO users(email,password,vorname,nachname,rolle,aktiv,passwort_geaendert_am) VALUES(\$1,\$2,\$3,\$4,\$5,true,NOW()) RETURNING id\",[\"qa-admin@qatest.example\",h,\"QA\",\"Admin\",\"mitarbeiter\"]);
  // Kunde (fuer Portal) — freigegeben + bestaetigt, damit Login klappt
  await db.query(\"DELETE FROM kunden WHERE portal_email=\$1 OR kunden_nr=\$2\",[\"qa-kunde@qatest.example\",\"K-9990\"]);
  const k=await db.query(\"INSERT INTO kunden(kunden_nr,vorname,nachname,email,portal_email,portal_password,portal_aktiv,portal_freigegeben,portal_email_bestaetigt,aktiv) VALUES(\$1,\$2,\$3,\$4,\$4,\$5,true,true,true,true) RETURNING id\",[\"K-9990\",\"QA\",\"Tester\",\"qa-kunde@qatest.example\",h]);
  console.log(\"OK admin=\"+u.rows[0].id+\" kunde=\"+k.rows[0].id); process.exit(0);
})().catch(e=>{console.error(\"ERR\",e.message);process.exit(1);});
"'
```

## 2. Echten Token über die Login-API holen (garantiert korrekte Form)
```bash
# Admin:
ssh root@161.97.187.239 "curl -s -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"qa-admin@qatest.example\",\"passwort\":\"QaTest1234!\"}'"
# Portal:
ssh root@161.97.187.239 "curl -s -X POST http://localhost:3001/api/portal/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"qa-kunde@qatest.example\",\"passwort\":\"QaTest1234!\"}'"
```
Aus der Antwort das Feld `token` nehmen.

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
ssh root@161.97.187.239 "sudo -u postgres psql -d reifenpro" <<'SQL'
DELETE FROM kunden WHERE portal_email='qa-kunde@qatest.example' OR kunden_nr='K-9990';
DELETE FROM audit_log WHERE user_id=(SELECT id FROM users WHERE email='qa-admin@qatest.example');
DELETE FROM users WHERE email='qa-admin@qatest.example';
SQL
```
Danach prüfen, dass 0 Reste bleiben. Token-Dateien aus dem Scratchpad löschen.
