# Bereich: Kundenportal

Der Selbstbedienungs-Bereich für Endkunden von Schröder & Scholz: eingelagerte Räder
ansehen, Termine buchen/verschieben/stornieren, Rechnungen, Fahrzeuge, Einwilligungen.
Zweisprachig DE/EN. Marke: „Schröder & Scholz", Akzent Gold #eab308.

## Frontend
- `portal.html` — Registrierung (mit automatischer Kundenverknüpfung), Login,
  Passwort-Reset, Einlagerungen, Termine, Fahrzeuge, Rechnungen. Theme Hell/Dunkel,
  echtes Wortbild (adaptiv), Umschalter in Auth- und App-Header.
- Rechtseiten: `agb.html`, `datenschutz.html`, `faq.html`, `impressum.html`, `termin.html`.
- Ausgeliefert als `/var/www/reifenpro/portal/index.html`, Domain www.schroeder-scholz.de/portal/.

## Backend (src/)
- routes: `portal-auth.js` (`authKunde`, Login/Register/Reset), `portal-daten.js`
  (Einlagerungen/Rechnungen/Fahrzeuge des eingeloggten Kunden), `termine.js` (Buchung),
  `kontakt.js`, `gast.js` (anonyme Anfragen/Termine).
- lib: `einwilligung.js`, `mailer.js`, `mail-template.js`.

## SICHERHEITS-KERN (immer prüfen)
Portal-Datentrennung: JEDE Query/Mutation MUSS auf die `kunde_id`/`kundennr` aus dem
JWT eingeschränkt sein — NIE auf eine ID aus dem Request allein (sonst IDOR: Kunde sieht
fremde Daten). Bei jeder Änderung hier `code-auditor` + `breaker` laufen lassen.

## Deploy
```
scp portal.html root@161.97.187.239:/var/www/reifenpro/portal/index.html
# Backend:
scp portal-daten.js root@161.97.187.239:/var/www/reifenpro-backend/src/routes/portal-daten.js
ssh root@161.97.187.239 'pm2 restart reifenpro'
```

## Eigenheiten / Learnings
- Safari-Passwortmanager: Login als `<div>`, NICHT `<form>` (sonst kein Vorschlag).
- termine-Tabelle: kein termin_typ-CHECK (freie Artikelnamen); anonyme Termine erlaubt
  (kontakt_name/telefon/email/kennzeichen dürfen NULL sein).
- Artikel brauchen `dauer_minuten`, um im Portal buchbar zu sein.
- Zeitzonen-Falle: `new Date('YYYY-MM-DD')` = UTC → in UTC+2 der Vortag. Immer `T12:00:00`
  anhängen oder aus getFullYear/Month/Date bauen.

## Tabus
- Admin-/CMS-Dateien nicht anfassen.
- Keine echten Kundendaten in Tests; Test-Portalkonten nur in Sandbox, danach löschen.
- Passwörter/Reset-Mails nie an reale Adressen in Tests.
