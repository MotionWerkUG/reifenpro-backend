# Kickoff: Bereich Homepage / CMS

## So startest du diese Konversation
Claude Code im Worktree `../reifenpro-worktrees/homepage` (Branch `bereich/homepage-cms`) öffnen und als erste Nachricht sinngemäß senden:

> Lies `.claude/bereiche/homepage-cms.md` und den Homepage/CMS-Abschnitt von `.claude/bereiche/AUDIT-2026-08-06.md`. Wir arbeiten ausschließlich am Bereich Homepage/CMS. Beginne mit Aufgabe 1 (Firmendaten-/Öffnungszeiten-Panel im CMS). Halte dich an die globalen Firmenprinzipien und nutze vor jedem Deploy den Skill `/release-gate`.

## Arbeitsauftrag (priorisiert)
1. **Firmendaten-/Öffnungszeiten-Panel im CMS** (die einzige echte Sackgasse). Neues Panel „Kontaktdaten & Öffnungszeiten" in `cms.html` mit GET/PUT auf `einstellungen`: Adresse, Telefon, E-Mail, Geo, Social-Links und Öffnungszeiten. Damit sind die häufigsten Änderungen (Feiertage, neue Nummer) ohne Admin pflegbar — genau der Zweck der Wiederverwendbarkeit.
2. **Öffnungszeiten-Modell entstarren** — Mittags-/Betriebspause, Feiertage/Ausnahmen, „nach Vereinbarung" (aktuell nur eine Von–Bis-Zeile in `homepage-render.js`).
3. **`tel:`-Button in die Kopfzeile** der generierten Website (stärkster Mobil-Conversion-Hebel für einen Reifendienst).
4. **Leistungs-Gruppenüberschrift editierbar** (aktuell „Unsere Leistungen" hartkodiert in `homepage-render.js`).
5. **Listen-Text-Editor:** in der Listen-Ansicht zeigt/speichert das Textarea rohe `<b>`-Tags — konsistent zur visuellen Rich-Text-Bearbeitung machen.
6. **Undo erweitern** auf Design/SEO/Navigation/Banner (aktuell nur Abschnitte).
7. **Aufräumen:** toter Inline-Buchungscode in `homepage-render.js` (`buchungHtml` rendert nur den Button, das JS-Formular läuft ins Leere und bläht jede Seite auf).

## Nötige Infos
- **Bereichs-Doc:** `.claude/bereiche/homepage-cms.md`. **Befunde:** `.claude/bereiche/AUDIT-2026-08-06.md`.
- **Live:** CMS unter https://admin.schroeder-scholz.de/cms.html · generierte Website https://www.schroeder-scholz.de (liegt unter `/var/www/schroeder-homepage/`).
- **CMS-Deploy:** `scp cms.html root@161.97.187.239:/var/www/reifenpro/cms.html`
- **Backend-Deploy:** `scp homepage.js …/src/routes/homepage.js`, `scp homepage-render.js …/src/lib/homepage-render.js`, `scp homepage-generate.js …/src/lib/homepage-generate.js`, dann `pm2 restart reifenpro`. **PM2 „sandumotion" (ID 0) NIE anfassen.**
- **DB:** `ssh root@161.97.187.239 "sudo -u postgres psql -d reifenpro"`. Öffnungszeiten/Kontakt liegen in Tabelle `einstellungen`.
- **Uploads-Falle:** `/uploads/` gibt es nur auf der www-Domain; CMS-Vorschau auf der admin-Domain braucht absolute URLs.
- **Spezifikation für Wiederverwendung:** `homepage-cms-uebergabe.md` (Repo-Root).

## Arbeitsweise
- Vor Deploy: Skill `/release-gate`; vor Commit Agent `reviewer`.
- **Bewusst FIX lassen:** die Google-Snippet-Vorschau und die Live-Website-Vorschau im CMS zeigen die echte Optik, NICHT die CMS-Oberfläche — nicht auf Theme-Tokens umstellen.
- **Verifikation:** CMS mit Test-Mitarbeiter-Token (`rp_token`) prüfen (Rezept: `.claude/bereiche/VERIFIKATION.md`); nach jeder Änderung die generierte Website gegenprüfen.
- **Tabus:** Admin-/Portal-Dateien nicht anfassen; öffentliche Inhalte publizieren nur mit Davids Freigabe; AGB anwaltlich noch nicht geprüft; keine echten personenbezogenen Daten in Test-Inhalten.
- **Firmenprinzipien:** echte Umlaute, keine Emojis, nichts unverifiziert als „behoben" melden, Deploy-Befehl mitschicken.

## Definition of Done je Aufgabe
Deployt, CMS in Hell UND Dunkel gesichtet, generierte Website gegengeprüft (auch mobil), PM2-Logs fehlerfrei, Commit auf `bereich/homepage-cms`.
