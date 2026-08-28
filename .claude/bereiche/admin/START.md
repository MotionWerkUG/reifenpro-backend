> ## STECKBRIEF — ZUERST LESEN (Stand 2026-08-28)
>
> - **Bereich:** Admin/Werkstatt. **Feste Session-Adresse:** `admin`.
> - **Arbeite im Worktree** `/home/deploy/projekte/reifenpro/admin` — NIE im Hauptordner `/home/deploy/projekte/reifenpro` (sonst instabile Session-Namen; der Hauptordner ist nur Deploy/Integration).
> - **Deine Zuständigkeit:** Admin/Werkstatt-App (frontend/index.html): Dashboard/Kunden/Einlagerung/Lager/Kalender/Werkstatt, Artikel-CRUD + Preise + online-buchbar/rolle, Einstellungen/Firmendaten, DSGVO, Mitarbeiter, termine.js.
> - **Was in eine andere Session gehört + Routing bei Überschneidungen:** `.claude/bereiche/SESSIONS.md` (verbindlich).
> - **Andere Sessions erreichen:** SendMessage an `homepage` / `portal` / `admin` / `rechnungswesen`; vorher ggf. `ListAgents` prüfen.
> - **Landkarte/Worktree-Modell:** `.claude/bereiche/LANDKARTE.md`. **Projektkontext:** `CLAUDE.md` (Hauptordner) + `.claude/bereiche/admin/CLAUDE.md`. **Dauerfakten:** Memory.
> - **Deploy:** Bereichs-Branch → `main` mergen → `sudo pm2 restart reifenpro` (Backend läuft aus main). Frontend: nach `/var/www/schroeder-homepage/` kopieren.
> - **Vor Freigabe:** Qualitäts-Gate (code-auditor/breaker/reviewer, ggf. gobd-pruefer/produkt-kritiker) + `/release-gate`.

# Kickoff: Admin / Werkstatt

Ordner **`/home/deploy/projekte/reifenpro/admin`** in Claude Code öffnen (eigener
Worktree für diesen Bereich, NICHT den Sammelordner `reifenpro`), dann als erste Nachricht:

> Lies `.claude/bereiche/admin/CLAUDE.md` und den Admin-Abschnitt von
> `.claude/bereiche/AUDIT-2026-08-06.md`. Wir arbeiten ausschließlich am Bereich
> Admin/Werkstatt (Rechnungen sind separat). Beginne mit Aufgabe 1. Vor Deploy `/release-gate`.

## Aufgaben (priorisiert, aus dem Audit)
1. **Räderwechsel als eine Aktion** auf dem Werkstattbrett (alten Satz auslagern + neuen
   vorbefüllt einlagern) — größter Alltags-Hebel, baut auf `wiedereinlagern` auf.
2. Ganzjahr/Allwetter einlagerbar (Formular kennt nur Winter/Sommer).
3. Walk-in ohne Termin am Werkstattbrett erfassbar.
4. Lagerplatz ändern per Modal statt `prompt()`.
5. Härtung: DSGVO-/Einlagerungslöschung mit FK-Kaskaden (S5, real), `termine`-Routen
   `requireStaff` (S8), Self-Lockout letzter Admin (S9).

Definition of Done: deployt, in Hell/Dunkel gesichtet, PM2-Logs sauber, Commit + Push.
