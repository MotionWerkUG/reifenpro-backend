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
