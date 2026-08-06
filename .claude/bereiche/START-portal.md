# Kickoff: Bereich Kundenportal

## So startest du diese Konversation
Claude Code im Worktree `../reifenpro-worktrees/portal` (Branch `bereich/portal`) öffnen und als erste Nachricht sinngemäß senden:

> Lies `.claude/bereiche/kundenportal.md` und den Portal-Abschnitt von `.claude/bereiche/AUDIT-2026-08-06.md`. Wir arbeiten ausschließlich am Bereich Kundenportal. Beginne mit Aufgabe 1 (Erststart-/Freigabe-Kommunikation). Beachte den Sicherheits-Kern (Portal-Datentrennung) und nutze vor jedem Deploy den Skill `/release-gate`.

## Arbeitsauftrag (priorisiert)
Bereits erledigt (nicht erneut anfassen): Leerzustand der Einlagerungen, Profil bearbeiten, Einwilligung widerrufen, Bestätigung erneut senden, S1-Strip im Backend.

1. **Erststart-/Freigabe-Kommunikation.** Nach Registrierung wartet der Kunde auf E-Mail-Bestätigung UND manuelle Admin-Freigabe, ohne zu wissen wie lange. Erwartungsmanagement einbauen (Status/Dauer, Hinweis „wir schalten frei"), damit der Erststart nicht ins Leere läuft.
2. **Passwort-Reset raus aus `prompt()`** (`portal.html`) — echtes Formular mit Wiederhol-Feld und Sichtbarkeit.
3. **Terminhistorie** — Endpoint `/daten/termine/vergangen` existiert, wird aber nie aufgerufen (toter Zweig in `ladeTermine`). Verdrahten.
4. **Buchung mit Bestätigungs-Zusammenfassung** statt sofort verbindlich (bei Terminen mit Preis: „Sie buchen X am … für … €").
5. **Überblick anreichern** — konkreter nächster Termin (Datum/Uhrzeit + Lagerplatz-Kürzel), HU-Warnung gebündelt, Führung für Leer-Konten.
6. **Rechtsseiten auf Hell/Dunkel** — `faq.html`, `datenschutz.html`, `agb.html`, `impressum.html` sind dark-only hartkodiert; ein Hell-Nutzer springt beim Öffnen in Dunkel. Auf dieselben Theme-Tokens umstellen wie das Portal.
7. **Härtung** (aus Audit): S2 `fahrzeug_id` beim Buchen/Verschieben gegen Eigentum prüfen (`portal-daten.js`); S6 Registrierung generisch antworten + `portal_email/password` erst nach Bestätigung wirksam (Account-Squatting/Enumeration); S7 Admin-Login-Timing (Dummy-Hash); S10 `freie-slots` Wochentag aus `YYYY-MM-DD`-String bauen.

## SICHERHEITS-KERN (immer prüfen)
Portal-Datentrennung: JEDE Query/Mutation MUSS auf die `kunde_id`/`kundennr` aus dem JWT eingeschränkt sein — NIE auf eine ID aus dem Request allein (IDOR). Bei jeder Änderung hier Agent `code-auditor` + `breaker` laufen lassen.

## Nötige Infos
- **Bereichs-Doc:** `.claude/bereiche/kundenportal.md`. **Befunde:** `.claude/bereiche/AUDIT-2026-08-06.md`.
- **Live:** https://www.schroeder-scholz.de/portal/ (ausgeliefert als `/var/www/reifenpro/portal/index.html`).
- **Portal-Deploy:** `scp portal.html root@161.97.187.239:/var/www/reifenpro/portal/index.html`
- **Backend-Deploy:** `scp portal-auth.js …/src/routes/portal-auth.js`, `scp portal-daten.js …/src/routes/portal-daten.js`, `scp termine.js …/src/routes/termine.js`, dann `pm2 restart reifenpro`. **PM2 „sandumotion" (ID 0) NIE anfassen.**
- **DB:** `ssh root@161.97.187.239 "sudo -u postgres psql -d reifenpro"`.
- **Endpoints (schon vorhanden):** `PUT /auth/profil`, `POST /auth/einwilligung-widerrufen`, `POST /auth/bestaetigung-erneut`, `GET /daten/termine/vergangen`.
- **Eigenheiten:** Safari-Passwortmanager → Login als `<div>`, nicht `<form>`. termine-Tabelle ohne termin_typ-CHECK, anonyme Termine erlaubt. Artikel brauchen `dauer_minuten` zum Buchen. Zeitzonen-Falle: `new Date('YYYY-MM-DD')` = UTC-Vortag → `T12:00:00` anhängen. Portal-Token-Key im localStorage: `rp_portal_token`.

## Arbeitsweise
- Vor Deploy: Skill `/release-gate`; bei allem Auth-/Daten-Nahen zusätzlich `code-auditor` + `breaker`; vor Commit `reviewer`.
- **Verifikation:** kurzlebigen Test-Kunden anlegen (portal_freigegeben=true, portal_email_bestaetigt=true), Token über Login-API holen, in `localStorage` (`rp_portal_token`) injizieren, Konto danach löschen. Rezept: `.claude/bereiche/VERIFIKATION.md`. NIE echte Kundendaten/-Mails in Tests.
- **Tabus:** Admin-/CMS-Dateien nicht anfassen; geteiltes Fundament nur nach Ankündigung.
- **Firmenprinzipien:** echte Umlaute, keine Emojis, zweisprachig DE/EN pflegen, nichts unverifiziert als „behoben" melden, Deploy-Befehl mitschicken.

## Definition of Done je Aufgabe
Deployt, im Browser als Test-Kunde in Hell UND Dunkel und in DE UND EN gesichtet, Datentrennung geprüft, PM2-Logs fehlerfrei, Commit auf `bereich/portal`.
