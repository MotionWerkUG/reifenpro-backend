# Bereich: Homepage / CMS

Die öffentliche Website von Schröder & Scholz und das CMS, mit dem sie ohne Technikwissen
gepflegt wird. Marke: „Schröder & Scholz", Gold #eab308. Es gilt `DESIGN.md`.

## Dateien
- Frontend CMS: `frontend/cms.html` (Redaktions-Werkzeug: Design/Schriften, SEO, Banner &
  Gutscheine, Buchung, Navigation, Medien, Abschnitte).
- Backend: `src/routes/homepage.js`, `src/lib/homepage-render.js`, `src/lib/homepage-generate.js`.
- Generierte Website: `/var/www/schroeder-homepage/index.html` (Domain www.schroeder-scholz.de).
- Inhalt/Design in DB: `homepage_sektionen`, `homepage_fonts`, `einstellungen` (Aktion, Kontakt, Öffnungszeiten).

## Deploy
- CMS: `scp frontend/cms.html root@161.97.187.239:/var/www/reifenpro/cms.html`
- Backend: nach `src/…`, dann `pm2 restart reifenpro`.
- **Website nach jeder inhaltlichen/Design-Änderung neu generieren** (statisch!):
  `cd /home/deploy/projekte/reifenpro && node -e 'require("dotenv").config(); require("./src/lib/homepage-generate").regenerate().then(()=>console.log("ok"))'`
  (dotenv NICHT vergessen — sonst DB-Fehler.) Der `PUT /api/homepage/banner`-Endpoint setzt + generiert in einem.

## Eigenheiten
- Google-Snippet- und Live-Vorschau im CMS sind bewusst FIX (echte Optik) — nicht auf Tokens umstellen.
- Uploads-Falle: `/uploads/` nur auf der www-Domain; CMS-Vorschau auf admin braucht absolute URLs.
- Aktionsbanner (Gutscheincode) kommt aus `einstellungen.aktion_*`.
- Wiederverwendbare Spezifikation: `homepage-cms-uebergabe.md` (Projektwurzel).

## Tabus
Admin-/Portal-/Rechnungs-Dateien nicht anfassen. Öffentliche Inhalte publizieren nur mit
Davids Freigabe (AGB anwaltlich ungeprüft). Keine echten personenbezogenen Testdaten.

## Werkzeuge
`produkt-kritiker` (Redakteur- + Besuchersicht), `reviewer` vor Commit, `ui-tester` (CMS +
generierte Seite, hell/dunkel, mobil). Vor Deploy: `/release-gate`. Verifikation: `../VERIFIKATION.md`.
Offene Punkte: `../AUDIT-2026-08-06.md` (Abschnitt Homepage/CMS).

## Scan-Upload unterschriebener Dokumente (QR-Weg)

`src/routes/dokument-scan.js` nimmt ein abfotografiertes, unterschriebenes Dokument
entgegen. Der Ausdruck traegt einen QR-Code, der Betrieb fotografiert das Blatt mit dem
Handy, der Scan haengt automatisch am richtigen Dokument. Wir nehmen nur auf — ausgeliefert
wird die Datei ausschliesslich vom Admin-Endpunkt.

**Nicht anfassen ohne Ruecksprache mit Admin und David (alles bewusst so entschieden):**
- Kein `capture`-Attribut am Datei-Feld. Es wuerde die einfache Kamera erzwingen und die
  Dokumentenerfassung des iPhone (Dateien durchsuchen -> Dokumente scannen) unerreichbar
  machen — die liefert ein begradigtes PDF statt eines schiefen Fotos (Davids Wunsch).
- Die Upload-Seite zeigt NUR die Dokumentart. Kein Name, kein Kennzeichen, keine
  Beleg-Nummer (die enthaelt das Kennzeichen). Wer den Ausdruck findet, lernt nichts.
- Token: 3 Tage Standard, 7 Maximum, fest im Code; nur Hochladen, kein Lesen des Dokuments;
  einmalig; beim Neuausstellen werden offene Token desselben Dokuments entwertet.
- `scan_pfad` und `unterschrift_weg` MUESSEN in einem einzigen UPDATE gesetzt werden — die
  Aufbewahrungssperre greift, sobald `scan_pfad` steht, und blockiert einen zweiten Schritt.
- Ablage `/home/deploy/projekte/reifenpro/dokument-scans/` als fester absoluter Pfad (der
  Admin-Endpunkt prueft dagegen), Rechte 640, Eigentuemer wie der Ordner. Nie unter
  `/var/www/...` — ein unterschriebener Beleg darf nie ueber eine ratbare URL erreichbar sein.
- Das Groessenlimit steht in `server.js` VOR dem globalen 1-MB-Parser. Ein Limit in der
  Route selbst ist wirkungslos, weil der Body dann schon geparst ist.
- **Kein Scan im Kundenportal** (Davids Entscheidung 2026-08-31): Der Kunde sieht nur den
  erzeugten Schein. Ein Foto faengt leicht mehr ein als das Blatt.
