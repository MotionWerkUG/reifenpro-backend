# Bereich: Admin / Werkstatt (ReifenPro-Oberfläche)

Das interne Werkzeug für Schröder & Scholz: Verwaltung, Werkstatt, Tresen. Marke „ReifenPro",
Gold #eab308, `DESIGN.md`. (Rechnungen sind ein EIGENER Bereich → `../rechnungswesen/`.)

## Dateien
- Frontend: `frontend/index.html` (Dashboard, Kunden, Einlagerung, Lagerplan, Kalender,
  Werkstatt, Statistik, Mitarbeiter, DSGVO, Einstellungen, Etikettendruck).
  Hinweis: die Rechnungen-Ansicht liegt AUCH in `index.html` → gehört Rechnungswesen; bei
  Änderungen dort abstimmen.
- Backend: `src/routes/` auth, users, kunden, einlagerungen, lager, artikel, protokolle,
  dokumente, dsgvo, einstellungen, gewerbe, gutscheine, aktivitaet, qr; `src/lib/protokoll-pdf.js`.
- Auth: `src/middleware/auth.js` (Mitarbeiter/Admin). Rollen serverseitig prüfen.

## Deploy
`scp frontend/index.html root@161.97.187.239:/var/www/reifenpro/index.html`; Backend nach
`src/…`, dann `pm2 restart reifenpro`. PM2 `sandumotion` NIE anfassen.

## Konventionen
- Kennzeichen WOR-AB-1234 (4 Felder). Dimension 205/55 R16 91W.
- Etikett: Kundenkürzel ohne Vokale, Lagerplatz riesig, Werkstatt orange/gelb.
- „Räderwechsel" (nicht „Reifenwechsel"). Wiedereinlagerung über `vorgaenger_id`-Kette.
- Erledigt: Theme-Fundament, „Abholbereit"-Buttons, „März"-Fix, S1-Escaping.

## Tabus
Portal-/CMS-Dateien nicht anfassen. Geteiltes Fundament (server.js, db, middleware, mailer)
nur nach Ankündigung. Rechnungslogik gehört Rechnungswesen. Keine echten Kundendaten in Tests.

## Werkzeuge
`produkt-kritiker` (Werkstatt-Alltag), `code-auditor`, `breaker`, `reviewer`, `ui-tester`.
Vor Deploy `/release-gate`. Verifikation: `../VERIFIKATION.md`. Offene Punkte:
`../AUDIT-2026-08-06.md` (Abschnitt Admin) — u. a. Räderwechsel-Ein-Klick, Ganzjahr-Typ, Walk-in.
