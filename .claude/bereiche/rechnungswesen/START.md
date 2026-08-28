> ## STECKBRIEF — ZUERST LESEN (Stand 2026-08-28)
>
> - **Bereich:** Rechnungswesen (= Rechnungen). **Feste Session-Adresse:** `rechnungswesen`.
> - **Arbeite im Worktree** `/home/deploy/projekte/reifenpro/rechnungswesen` — NIE im Hauptordner `/home/deploy/projekte/reifenpro` (sonst instabile Session-Namen; der Hauptordner ist nur Deploy/Integration).
> - **Deine Zuständigkeit:** Rechnungswesen = Rechnungen (EIN Bereich): rechnungen.js, Rechnung aus Termin, GoBD/§14, Nummernkreis, PDF, Storno, Export/DATEV, Belege-Aufbewahrung/Backup.
> - **Was in eine andere Session gehört + Routing bei Überschneidungen:** `.claude/bereiche/SESSIONS.md` (verbindlich).
> - **Andere Sessions erreichen:** SendMessage an `homepage` / `portal` / `admin` / `rechnungswesen`; vorher ggf. `ListAgents` prüfen.
> - **Landkarte/Worktree-Modell:** `.claude/bereiche/LANDKARTE.md`. **Projektkontext:** `CLAUDE.md` (Hauptordner) + `.claude/bereiche/rechnungswesen/CLAUDE.md`. **Dauerfakten:** Memory.
> - **Deploy:** Bereichs-Branch → `main` mergen → `sudo pm2 restart reifenpro` (Backend läuft aus main). Frontend: nach `/var/www/schroeder-homepage/` kopieren.
> - **Vor Freigabe:** Qualitäts-Gate (code-auditor/breaker/reviewer, ggf. gobd-pruefer/produkt-kritiker) + `/release-gate`.

# Kickoff: Rechnungswesen

Ordner **`/home/deploy/projekte/reifenpro/rechnungswesen`** in Claude Code öffnen (eigener
Worktree für diesen Bereich, NICHT den Sammelordner `reifenpro`), dann als erste Nachricht:

> Lies `.claude/bereiche/rechnungswesen/CLAUDE.md`. Wir arbeiten ausschließlich am
> Rechnungswesen. Bei JEDER Änderung `gobd-pruefer` laufen lassen (Nummernkreis, § 14 UStG,
> Aufbewahrung, Rundung). Vor Deploy `/release-gate`. Nichts rückdatieren, nichts löschen.

## Aufgaben (priorisiert)
1. Rechnungsdatum beim Festschreiben serverseitig begrenzen (keine Rückdatierung, Audit S3).
2. Nummernkreis-Lückenlosigkeit + § 14-Vollständigkeit per Test absichern (`test-autor`).
3. PDF-Layout gegen `DESIGN.md` prüfen (Pflichtangaben klar, professionell).
4. DATEV-Export/Konten (`datev_*`) prüfen/vervollständigen, falls genutzt.
5. Mahnwesen (falls geplant) sauber und rechtssicher ergänzen.

Definition of Done: `gobd-pruefer` ohne kritische Funde, Tests grün, deployt, PM2-Logs sauber,
Commit + Push. Reale Belege in `rechnungen/` bleiben unangetastet.
