# Kickoff: Admin / Werkstatt

Projekt `/home/deploy/projekte/reifenpro` öffnen, dann als erste Nachricht:

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
