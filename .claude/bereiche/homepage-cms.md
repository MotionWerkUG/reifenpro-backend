# Bereich: Homepage / CMS

Die öffentliche Website von Schröder & Scholz plus das CMS, mit dem sie ohne Technikwissen
gepflegt wird. Marke: „Schröder & Scholz" (nur dieser Name öffentlich), Akzent Gold #eab308.

## Frontend
- `cms.html` — das Redaktions-Werkzeug (Visuelle Vorschau + Einstellungen/Listen):
  Design & Schriften (eigene Fonts hochladen, selbst gehostet), SEO, Banner & Gutscheine,
  Buchung, Navigation, Medien, Abschnitte. Theme: Hell/Dunkel wie Admin, Wortbild adaptiv.
- Die eigentliche Website wird serverseitig generiert (siehe unten) und liegt unter
  `/var/www/schroeder-homepage/` (Domain www.schroeder-scholz.de).

## Backend (src/)
- routes: `homepage.js` (CRUD für Abschnitte, Design, Fonts, Medien, SEO)
- lib: `homepage-render.js` (rendert die Seite), `homepage-generate.js` (baut die statische
  Ausgabe). `daten jsonb`-Spalte für strukturierten Abschnitts-Inhalt.

## Deploy
```
# CMS-Oberflaeche:
scp cms.html root@161.97.187.239:/var/www/reifenpro/cms.html
# Backend:
scp homepage.js root@161.97.187.239:/var/www/reifenpro-backend/src/routes/homepage.js
scp homepage-render.js root@161.97.187.239:/var/www/reifenpro-backend/src/lib/homepage-render.js
ssh root@161.97.187.239 'pm2 restart reifenpro'
```
Uploads-Falle: `/uploads/` gibt es nur auf der www-Domain; CMS-Vorschau auf der
admin-Domain braucht absolute URLs.

## Wiederverwendbar
`homepage-cms-uebergabe.md` (Repo-Root) ist die ausführliche Spezifikation, damit dasselbe
CMS für andere Kundenhomepages nachgebaut werden kann.

## Aktueller Stand / offen
- Erledigt: Design-/Font-/SEO-/Rich-Content-/Medien-System, Theme-Fundament, Bedien-Komfort
  (Sprungmenü, Rich-Text-Tooltips, Alt-Text-Hinweis, Medien-Filter).
- Google- und Live-Website-Vorschau im CMS sind bewusst FIX (zeigen echte Optik, nicht die
  CMS-Oberfläche) — nicht auf Theme-Tokens umstellen.

## Tabus
- Admin-/Portal-Dateien nicht anfassen.
- Öffentliche Inhalte publizieren = mit David abstimmen. AGB anwaltlich noch nicht geprüft.
- Keine echten personenbezogenen Daten in Test-Inhalten.
