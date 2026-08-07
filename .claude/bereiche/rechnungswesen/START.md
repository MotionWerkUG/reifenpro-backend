# Kickoff: Rechnungswesen

Projekt `/home/deploy/projekte/reifenpro` öffnen, dann als erste Nachricht:

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
