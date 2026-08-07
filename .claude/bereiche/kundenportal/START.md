# Kickoff: Kundenportal

Projekt `/home/deploy/projekte/reifenpro` öffnen, dann als erste Nachricht:

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
