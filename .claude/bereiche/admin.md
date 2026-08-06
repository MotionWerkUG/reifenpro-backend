# Bereich: Admin / Werkstatt

Das interne Werkzeug für Schröder & Scholz (Verwaltung, Werkstatt, Tresen).
Marke im Admin: „ReifenPro", Akzent Marken-Gold #eab308.

## Frontend
- `index.html` — eine Single-Page-App (Dashboard, Kunden, Einlagerung, Lagerplan,
  Kalender, Werkstatt, Statistik, Mitarbeiter, DSGVO, Einstellungen, Etikettendruck A7).
- API-Pfad: `/reifenpro/api`. Theme-System: Hell (Standard, folgt System) + Dunkel,
  Umschalter im Header, `localStorage rp_theme`, Tokens in `:root` / `@media` / `[data-theme]`.

## Backend (src/)
- routes: `auth.js`, `users.js`, `kunden.js`, `einlagerungen.js`, `lager.js`, `artikel.js`,
  `rechnungen.js`, `protokolle.js`, `dokumente.js`, `dsgvo.js`, `einstellungen.js`,
  `gewerbe.js`, `gutscheine.js`, `aktivitaet.js`, `qr.js`
- lib: `rechnung-pdf.js`, `protokoll-pdf.js`, `preis.js`
- Auth: `middleware/auth.js` (Mitarbeiter/Admin). Rollen serverseitig prüfen.

## Deploy
```
scp index.html root@161.97.187.239:/var/www/reifenpro/index.html
# Backend:
scp <datei>.js root@161.97.187.239:/var/www/reifenpro-backend/src/routes/<datei>.js
ssh root@161.97.187.239 'pm2 restart reifenpro'
```

## Wichtige Konventionen
- Kennzeichen WOR-AB-1234 (4 Felder). Dimension 205/55 R16 91W.
- Etikett: Kundenkürzel ohne Vokale (z. B. „A.Gbry"), Lagerplatz riesig, Werkstatt orange/gelb.
- Rechnung: GoBD, § 14 UStG, fortlaufende Rechnungsnummer (RE-JJJJ-NNNN), Regelbesteuerung.
- „Räderwechsel" (nicht „Reifenwechsel"). Wiedereinlagerung über `vorgaenger_id`-Kette.

## Aktueller Stand / offen
- Erledigt: Theme-Fundament (Gold + Hell/Dunkel), QA-Fixes (Lagerplan, Preislogik, Storno,
  Validierung), Radsatz-Historie.
- Offen (größer, eigene Runde): „Heute"-Arbeitsbrett (workflow-first), Rad-Quartett-Kacheln,
  Kapazitätsanzeige. Offene Frage: Header „ReifenPro" vs. „Schröder & Scholz".

## Tabus
- Geteiltes Fundament (`server.js`, `db/`, `middleware/`, `mailer`) nur nach Ankündigung.
- Portal-/CMS-Dateien nicht anfassen (eigene Bereiche).
- Keine echten Kundendaten in Tests. Vor Go-live: Sandbox-Testdaten zurücksetzen.
