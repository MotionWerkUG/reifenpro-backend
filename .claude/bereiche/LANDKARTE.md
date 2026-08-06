# ReifenPro — Bereichs-Landkarte

> **Aktualisierung 2026-08-06 (Modell A):** ReifenPro laeuft/entwickelt jetzt auf dem Server unter `/home/deploy/projekte/reifenpro` (Details: CLAUDE.md, Abschnitt Betrieb & Standort). Die frueheren Mac-Worktrees und scp-Deploy-Befehle in diesen Bereichs-Docs sind ueberholt: Deploy = `git pull` + `pm2 restart reifenpro` (Frontend nach /var/www/reifenpro kopieren). Datei-Listen, Audit und Aufgaben je Bereich gelten weiter.

Das Projekt wird in drei getrennten Konversationen weiterbearbeitet. Jede Konversation
bleibt in ihrem Revier. Diese Datei ist die Übersicht; die Details je Bereich stehen in
`admin.md`, `homepage-cms.md`, `kundenportal.md`.

## Die drei Bereiche

| Bereich | Frontend | Backend (src/) | Doc |
|---|---|---|---|
| **Admin / Werkstatt** | `index.html` | routes: auth, users, kunden, einlagerungen, lager, artikel, rechnungen, protokolle, dokumente, dsgvo, einstellungen, gewerbe, gutscheine, aktivitaet, qr · lib: rechnung-pdf, protokoll-pdf, preis | [admin.md](admin.md) |
| **Homepage / CMS** | `cms.html` (+ generierte Website) | routes: homepage · lib: homepage-render, homepage-generate | [homepage-cms.md](homepage-cms.md) |
| **Kundenportal** | `portal.html` (+ agb/datenschutz/faq/impressum/termin.html) | routes: portal-auth, portal-daten, termine, kontakt, gast · lib: einwilligung, mailer, mail-template | [kundenportal.md](kundenportal.md) |

## Geteiltes Fundament (mit Bedacht anfassen — betrifft alle Bereiche)
`src/server.js`, `src/db/index.js`, `src/middleware/auth.js`, `src/middleware/errorHandler.js`,
`src/lib/bildverarbeitung.js`, `src/lib/mailer.js`, `cron-erinnerungen.js`.
Änderungen hier immer ankündigen und besonders vorsichtig prüfen (reviewer + code-auditor).

## Repo-Layout-Falle
Im Repo liegen die `.js` **flach im Root** (z. B. `portal-daten.js`), auf dem Server aber
unter `src/routes/`, `src/lib/`, `src/middleware/`, `src/db/`. Beide sind byte-identisch.
Das Repo ist die versionierte Quelle; die Laufzeit-Ordnerstruktur ist `src/…`.
`require('../db/index')` in einer Root-Datei bezieht sich also auf `src/db/index.js`.

## Arbeiten in getrennten Konversationen (Worktrees)
Jeder Bereich hat einen eigenen git-Worktree + Branch, damit parallele Sessions sich nicht
ins Gehege kommen (globale Regel: eine aktive Session pro Arbeitsbaum).

```
../reifenpro-worktrees/admin      → Branch bereich/admin
../reifenpro-worktrees/homepage   → Branch bereich/homepage-cms
../reifenpro-worktrees/portal     → Branch bereich/portal
```

Ablauf pro Bereichs-Konversation:
1. Claude Code im jeweiligen Worktree-Ordner öffnen (nicht im Haupt-Repo).
2. Das passende Kickoff-Doc als Einstieg nutzen (fertige Anweisung + alle Infos):
   [START-admin.md](START-admin.md) · [START-homepage-cms.md](START-homepage-cms.md) · [START-portal.md](START-portal.md).
3. Nur Dateien des Bereichs anfassen; geteiltes Fundament nur nach Ankündigung.
4. Vor Deploy: Skill `release-gate`. Deploy per scp auf den Server (siehe Bereichs-Doc).
   Verifikation im Browser: [VERIFIKATION.md](VERIFIKATION.md) (Testkonto/Token/Aufräumen).
5. Branch später nach `main` mergen (ein Reviewer-Durchlauf davor).

## Verfügbare Agenten (`.claude/agents/`)
`produkt-kritiker` (Zweck-Bewertung), `code-auditor` (Sicherheit/Portal-Datentrennung),
`breaker` (aktiv brechen), `reviewer` (Diff vor Commit), `ui-tester` (laufende App im
Browser), `test-autor` (Tests), `explorer` (Code-Lokalisierung).
Skill: `release-gate` (Vor-Deploy-Tor).
