# Kickoff: Bereich Admin / Werkstatt

## So startest du diese Konversation
Claude Code im Worktree `../reifenpro-worktrees/admin` (Branch `bereich/admin`) öffnen und als erste Nachricht sinngemäß senden:

> Lies `.claude/bereiche/admin.md` und den Admin-Abschnitt von `.claude/bereiche/AUDIT-2026-08-06.md`. Wir arbeiten ausschließlich am Bereich Admin/Werkstatt. Beginne mit Aufgabe 1 (Räderwechsel als Ein-Klick). Halte dich an die globalen Firmenprinzipien und nutze vor jedem Deploy den Skill `/release-gate`.

## Arbeitsauftrag (priorisiert)
Bereits erledigt (nicht erneut anfassen): „März"-Fix, „Abholbereit"-Buttons, S1-Escaping im Frontend.

1. **Räderwechsel als eine Aktion** (größter Alltags-Hebel). Auf dem Werkstattbrett ein „Wechsel fertig": alten Satz auslagern (Abgeholt) + neuen Satz vorbefüllt einlagern (Profiltiefe neu abfragen), baut auf `wiedereinlagern` auf.
2. **Ganzjahr/Allwetter einlagerbar** — Einlagerungsformular kennt nur Winter/Sommer (`index.html`), Dashboard/Farblogik kennen „Ganzjahr" schon.
3. **Walk-in ohne Termin** direkt am Werkstattbrett erfassbar machen (Laufkundschaft).
4. **Lagerplatz ändern per Modal** statt `prompt()` (Touch-Tresen), mit Platz-Validierung.
5. **Härtung** (aus Audit): S3 Rechnungsdatum beim Festschreiben serverseitig begrenzen (GoBD-Rückdatierung); S5 Kunden-/Einlagerungslöschung mit FK-Kaskaden + Dateibereinigung (bestätigt real — `audit_log`-FK); S8 `termine.js`-Routen `requireStaff` ergänzen; S9 letzten aktiven Admin vor Selbst-Deaktivierung/Löschung schützen.

## Nötige Infos
- **Bereichs-Doc:** `.claude/bereiche/admin.md` (Dateien, Deploy, Konventionen, Tabus). **Befunde:** `.claude/bereiche/AUDIT-2026-08-06.md`.
- **Live:** https://admin.schroeder-scholz.de · API-Pfad `/api` (bzw. `/reifenpro/api`).
- **Frontend-Deploy:** `scp index.html root@161.97.187.239:/var/www/reifenpro/index.html`
- **Backend-Deploy:** `scp <datei>.js root@161.97.187.239:/var/www/reifenpro-backend/src/routes/<datei>.js` bzw. `.../src/lib/<datei>.js`, dann `ssh root@161.97.187.239 'pm2 restart reifenpro'`. **PM2 „sandumotion" (ID 0) NIE anfassen.**
- **DB:** `ssh root@161.97.187.239 "sudo -u postgres psql -d reifenpro"` (nur postgres, nicht reifenpro_user).
- **Repo-Falle:** `.js` liegen im Repo flach im Root, auf dem Server unter `src/…` (byte-identisch).

## Arbeitsweise
- Vor Deploy: Skill `/release-gate`. Bei Auth-/Routen-/SQL-Änderungen zusätzlich Agent `code-auditor` bzw. `breaker`; vor Commit `reviewer`.
- **Verifikation im Browser** (echte Bestätigung, keine Behauptung): kurzlebigen Test-Mitarbeiter anlegen, Token über die Login-API holen, in `localStorage` (`rp_token`) injizieren, Test-Konto danach löschen (Löschung braucht ggf. vorher `DELETE FROM audit_log WHERE user_id=…`). Rezept siehe `.claude/bereiche/VERIFIKATION.md`.
- **Tabus:** Portal-/CMS-Dateien nicht anfassen; geteiltes Fundament (`server.js`, `db/`, `middleware/`, `mailer`) nur nach Ankündigung; keine echten Kundendaten in Tests.
- **Firmenprinzipien:** echte Umlaute (ä/ö/ü/ß, nie ae/oe/ue), keine Emojis, nichts als „behoben" bezeichnen ohne verifizierbare Bestätigung, bei Frontend-Lieferung Deploy-Befehl mitschicken.

## Definition of Done je Aufgabe
Deployt, im Browser in Hell UND Dunkel gesichtet, PM2-Logs fehlerfrei, Commit auf `bereich/admin` mit klarer Message.
