> ## STECKBRIEF — ZUERST LESEN (Stand 2026-08-28)
>
> - **Bereich:** Kundenportal. **Feste Session-Adresse:** `reifenpro-portal`.
> - **Arbeite im Worktree** `/home/deploy/projekte/reifenpro-portal` — NIE im Hauptordner `/home/deploy/projekte/reifenpro` (sonst instabile Session-Namen; der Hauptordner ist nur Deploy/Integration).
> - **Deine Zuständigkeit:** Kundenportal + Gast-Buchung (Backend): portal.html, gast.js, portal-auth/-daten, Registrierung/Login/Reset, Gast-Termin, Bestätigungs-/Kundenmails, öffentliche Gutschein-Prüfung, buchbar_ab-Ausgabe/-Durchsetzung.
> - **Was in eine andere Session gehört + Routing bei Überschneidungen:** `.claude/bereiche/SESSIONS.md` (verbindlich).
> - **Andere Sessions erreichen:** SendMessage an `reifenpro-homepage` / `reifenpro-portal` / `reifenpro-admin` / `reifenpro-rechnungen`; vorher ggf. `ListAgents` prüfen.
> - **Landkarte/Worktree-Modell:** `.claude/bereiche/LANDKARTE.md`. **Projektkontext:** `CLAUDE.md` (Hauptordner) + `.claude/bereiche/kundenportal/CLAUDE.md`. **Dauerfakten:** Memory.
> - **Deploy:** Bereichs-Branch → `main` mergen → `sudo pm2 restart reifenpro` (Backend läuft aus main). Frontend: nach `/var/www/schroeder-homepage/` kopieren.
> - **Vor Freigabe:** Qualitäts-Gate (code-auditor/breaker/reviewer, ggf. gobd-pruefer/produkt-kritiker) + `/release-gate`.

# Kickoff: Kundenportal

Ordner **`/home/deploy/projekte/reifenpro-portal`** in Claude Code öffnen (eigener
Worktree für diesen Bereich, NICHT den Sammelordner `reifenpro`), dann als erste Nachricht:

> Lies `.claude/bereiche/kundenportal/CLAUDE.md` und den Portal-Abschnitt von
> `.claude/bereiche/AUDIT-2026-08-06.md`. Wir arbeiten ausschließlich am Kundenportal.
> Beachte den Sicherheits-Kern (Portal-Datentrennung). Beginne mit Aufgabe 1.
> Vor jedem Deploy `/release-gate`; bei Auth/Daten zusätzlich `code-auditor` + `breaker`.

## Aufgaben (priorisiert, aus dem Audit)
1. Erststart-/Freigabe-Kommunikation (Neukunde sieht evtl. „keine Einlagerungen"; Dauer/Status erklären).
2. Passwort-Reset raus aus `prompt()` — echtes Formular.
3. Terminhistorie verdrahten (`GET /daten/termine/vergangen` existiert, ungenutzt).
4. Buchung mit Bestätigungs-Zusammenfassung; Überblick anreichern (nächster Termin, Lagerplatz, HU).
5. Rechtsseiten (faq/datenschutz/agb/impressum) auf Hell/Dunkel-Tokens.
6. Härtung: `fahrzeug_id`-Eigentumsprüfung (S2), Registrierungs-Enumeration (S6), Login-Timing (S7).

Definition of Done: deployt, als Test-Kunde in Hell/Dunkel und DE+EN gesichtet,
Datentrennung geprüft, PM2-Logs sauber, Commit + Push.
