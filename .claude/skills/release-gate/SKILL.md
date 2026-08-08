---
name: release-gate
description: Vor-Deploy-Pruefung fuer ReifenPro — saubere Diff, Node-Syntaxcheck, ggf. Tests, kritischer Review + Sicherheits-/Portal-Datentrennungs-Check, dann Deploy auf den Server und Health-Check. Checkliste mit Abbruch bei Rot.
---

# Release-Gate (vor jedem Prod-Deploy von ReifenPro)

Ziel: nichts geht live, das nicht durch dieses Tor ist. Bei einem roten Punkt: STOP,
erst beheben. ReifenPro hat KEINEN Build/tsc-Schritt (reines Node/Express + HTML),
darum liegt der Fokus auf Syntaxcheck, Review und Smoke-Test.

## Ablauf
1. Sauberer Stand: nur eigene, verstandene Aenderungen im Diff (`git status`, `git diff`).
   Fremde WIP nicht mitnehmen. Auf einem Branch arbeiten (bzw. im Bereichs-Worktree).
2. Statische Pruefung:
   - Backend (`.js`): `node --check <datei>` fuer jede geaenderte Datei → 0 Fehler.
   - Frontend (`index.html`, `cms.html`, `portal.html`): die Inline-`<script>`-Bloecke
     syntaktisch pruefen (z. B. mit `new Function(block)`), keine offensichtlichen Fehler.
   - Falls Tests existieren: `node --test` (oder das Projektframework) → alle gruen.
3. Kritischer Review: `reviewer`-Agent ueber den Diff. Bei Aenderungen an Auth, Routen,
   SQL oder Portal-Daten zusaetzlich `code-auditor` bzw. `breaker`. Funde beheben.
4. Deploy (Modell A — Code liegt auf dem Server, gearbeitet wird im Bereichs-Worktree):
   - Backend: Bereichs-Branch nach `main` mergen, dann im Deploy-Ordner
     `/home/deploy/projekte/reifenpro` (`git pull`/`git checkout main` + `git merge`) und
     `pm2 restart reifenpro`. NICHT ins alte `/var/www/reifenpro-backend` (inaktiv).
   - Frontend: Datei nach `/var/www/reifenpro/` kopieren (`cp`, ggf. `sudo`; Portal:
     `/var/www/reifenpro/portal/index.html`). CMS-Website zusaetzlich neu generieren
     (siehe `bereiche/homepage/`).
   - PM2-Prozess „sandumotion" (ID 0) NIEMALS anfassen.
5. Health-Check: betroffene Seite/Route aufrufen (HTTP 200), PM2-Logs auf Fehler pruefen
   (`pm2 logs reifenpro --lines 30 --nostream`). Bei Frontend zusaetzlich kurz im Browser
   in Hell- UND Dunkelmodus sichten.
6. Nachweis: kurz festhalten, was geprueft/deployt wurde. Rollback-Weg bereithalten
   (vorherige Datei/Version zurueckspielen + `pm2 restart reifenpro`).

## Abbruchregeln
- Syntaxcheck/Tests rot → nicht deployen.
- Ungeklaerter Sicherheits-/Portal-Datentrennungs-Fund → nicht deployen.
- Health-Check nach Deploy nicht sauber → sofort Rollback.

## Erinnerung
Deutsch, echte Umlaute, keine Emojis. Bei Frontend-Lieferung den `cp`-Deploy-Befehl
mitschicken. Server-weite Schritte (nginx/DB-Migration) nur nach ausdruecklicher Freigabe.
Hinweis: ReifenPro hat KEINE Staging-Umgebung (eigener Einzelbetrieb) — es wird direkt auf
Prod deployt; umso wichtiger ist dieses Tor.
