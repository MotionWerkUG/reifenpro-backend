# Bereich: Kundenportal (Kundenoberfläche)

Selbstbedienung für Endkunden: eingelagerte Räder ansehen, Termine buchen/verschieben/
stornieren, Rechnungen, Fahrzeuge, Einwilligungen. Zweisprachig DE/EN. Gold #eab308, `DESIGN.md`.

## Dateien
- Frontend: `frontend/portal/index.html` (= portal.html) + agb/datenschutz/faq/impressum.
- Backend: `src/routes/portal-auth.js`, `portal-daten.js`, `termine.js`, `gast.js` (anonyme/
  Gäste-Buchung!), `kontakt.js`; `src/lib/einwilligung.js`, `mailer.js`.
- Ausgeliefert als `/var/www/reifenpro/portal/index.html` (www.schroeder-scholz.de/portal/).
- Gäste-Buchung ohne Login: `/termin/` (Flyer-QR). Login/Portal optional.

## SICHERHEITS-KERN (immer prüfen)
Portal-Datentrennung: JEDE Query/Mutation MUSS auf `kunde_id` aus dem JWT eingeschränkt sein —
NIE auf eine ID aus dem Request allein (IDOR). Bei jeder Änderung `code-auditor` + `breaker`.

## Deploy
`scp frontend/portal/index.html root@161.97.187.239:/var/www/reifenpro/portal/index.html`;
Backend nach `src/…`, dann `pm2 restart reifenpro`.

## Eigenheiten
- Safari-Passwortmanager: Login als `<div>`, NICHT `<form>`.
- termine ohne termin_typ-CHECK; anonyme Termine erlaubt (Kontaktfelder dürfen NULL sein).
- Artikel brauchen `dauer_minuten` zum Buchen. Slots via `GET /api/gast/slots`.
- Zeitzonen-Falle: `new Date('YYYY-MM-DD')` = UTC-Vortag → `+'T12:00:00'`.
- Portal-Token im localStorage: `rp_portal_token`.
- Bereits verdrahtet: Profil bearbeiten, Einwilligung widerrufen, Bestätigung erneut senden.
- Gast-Buchung ist Double-Opt-in: erst `angefragt` + `bestaetigung_token` (45 Min), erst der POST
  auf den Mail-Link bucht verbindlich. GET zeigt nur eine Seite mit Button — nie Zustand ändern,
  sonst bestätigen Mail-Scanner (Safe Links) den Termin per Prefetch.
- Gast-Absage ohne Konto: signierter Link (JWT `typ:'gast-storno'`, 180 Tage) in der
  Bestätigungsmail → `GET/POST /api/gast/termin/absagen`. Wirkt nur auf Termine mit
  `kunden_id IS NULL` und Status `bestaetigt`; innerhalb der Stornofrist nur telefonisch.
- Öffnungszeiten kommen aus dem Wochenraster (`oeffnung.regulaereWoche()`, Index 0 = Montag).
  Die Alt-Felder `mo_fr_*`/`sa_*`/`so_*` sind nur Rückfallebene (ein Mo–Fr-Block, keine Sa/So-Pause);
  ist die Tabelle `oeffnungszeiten` leer, liefern die Portal-Endpunkte `woche: null`.

## Tabus
Admin-/CMS-/Rechnungs-Dateien nicht anfassen; geteiltes Fundament nur nach Ankündigung.
Keine echten Kundendaten/-Mails in Tests; Test-Portalkonten danach löschen.

## Werkzeuge
`code-auditor` + `breaker` (Pflicht bei Auth/Daten), `produkt-kritiker`, `reviewer`,
`ui-tester` (DE+EN, hell/dunkel). Vor Deploy `/release-gate`. Verifikation: `../VERIFIKATION.md`.
Offene Punkte: `../AUDIT-2026-08-06.md` (Abschnitt Portal).
