# ReifenPro — Bereichs-Landkarte

ReifenPro ist EIN Serverprojekt (`/home/deploy/projekte/reifenpro`, Modell A). Für die
Arbeit in getrennten Sessions ist es in **vier Bereiche** geteilt. Jeder Bereich hat einen
eigenen Ordner mit knappem `CLAUDE.md` (Kontext) + `START.md` (Einstieg).

## So arbeitest du token-sparsam
- **Immer das Projekt öffnen** (`/home/deploy/projekte/reifenpro`), NICHT einzelne Unterordner.
- Zu Beginn sagst du, welcher Bereich: „Lies `.claude/bereiche/<bereich>/START.md`."
- **Agents & Skills liegen EINMAL zentral** in `.claude/agents` + `.claude/skills` und sind
  damit in JEDER Session automatisch da — sie werden NICHT pro Ordner dupliziert. Das hält
  den Kontext klein. Ihre Beschreibung ist leichtgewichtig; der volle Text lädt erst beim Aufruf.
- Root-`CLAUDE.md` bleibt schlank; Bereichs-Details lädst du nur bei Bedarf über das Bereichs-Doc.

## Die vier Bereiche

| Bereich | Ordner | Frontend | Backend (src/) |
|---|---|---|---|
| **Homepage/CMS** | `bereiche/homepage/` | `frontend/cms.html` (+ generierte Website) | routes/homepage · lib/homepage-render, homepage-generate |
| **Kundenportal** | `bereiche/kundenportal/` | `frontend/portal/` | routes/portal-auth, portal-daten, termine, gast, kontakt · lib/einwilligung |
| **Admin/Werkstatt** | `bereiche/admin/` | `frontend/index.html` | routes/auth, users, kunden, einlagerungen, lager, artikel, dokumente, dsgvo, einstellungen, gewerbe, gutscheine, aktivitaet, qr · lib/protokoll-pdf |
| **Rechnungswesen** | `bereiche/rechnungswesen/` | Rechnungen-Bereich in `frontend/index.html` (geteilt mit Admin) | routes/rechnungen · lib/rechnung-pdf, preis |

**Geteiltes Fundament** (mit Bedacht, betrifft alle): `src/server.js`, `src/db/index.js`,
`src/middleware/auth.js`, `src/middleware/errorHandler.js`, `src/lib/mailer.js`,
`src/lib/bildverarbeitung.js`. `frontend/index.html` teilen sich Admin + Rechnungswesen.

## Werkzeuge (überall verfügbar)
Agents: `produkt-kritiker`, `code-auditor` (Node/Express + Portal-Datentrennung), `breaker`,
`reviewer`, `ui-tester`, `test-autor`, `explorer` und `gobd-pruefer` (Rechnungswesen).
Skill: `/release-gate` (Vor-Deploy-Tor). Verifikation im Browser: `bereiche/VERIFIKATION.md`.
Befunde/To-dos: `bereiche/AUDIT-2026-08-06.md`. Design: `DESIGN.md` (CI).

## Deploy (Modell A, für alle Bereiche gleich)
Backend: `git pull && pm2 restart reifenpro`. Frontend: Datei nach `/var/www/reifenpro/`
kopieren (Portal nach `/var/www/reifenpro/portal/`). CMS-Website zusätzlich neu generieren
(siehe `bereiche/homepage/`). PM2 `sandumotion` NIE anfassen. Details in der Root-`CLAUDE.md`.
