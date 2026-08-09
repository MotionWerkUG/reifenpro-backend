# Kickoff: Homepage / CMS

Ordner **`/home/deploy/projekte/reifenpro-homepage`** in Claude Code öffnen (eigener
Worktree für diesen Bereich, NICHT den Sammelordner `reifenpro`), dann als erste Nachricht:

> Lies `.claude/bereiche/homepage/CLAUDE.md` und den Homepage-Abschnitt von
> `.claude/bereiche/AUDIT-2026-08-06.md`. Wir arbeiten ausschließlich am Bereich Homepage/CMS.
> Beginne mit Aufgabe 1. Halte dich an `DESIGN.md` und nutze vor jedem Deploy `/release-gate`.

## Aufgaben (priorisiert, aus dem Audit)
1. **Firmendaten-/Öffnungszeiten-Panel im CMS** (einzige echte Sackgasse) — GET/PUT auf
   `einstellungen` (Adresse, Telefon, E-Mail, Geo, Social, Öffnungszeiten) in `frontend/cms.html`.
2. Öffnungszeiten-Modell entstarren (Mittagspause/Feiertage/„nach Vereinbarung").
3. `tel:`-Button in die Kopfzeile der generierten Website (Mobil-Conversion).
4. Leistungs-Gruppenüberschrift editierbar; Listen-Text-Editor zeigt rohe `<b>`-Tags.
5. Undo auf Design/SEO/Navigation erweitern; toten Inline-Buchungscode in homepage-render aufräumen.

Definition of Done: deployt, generierte Website neu erzeugt und in Hell/Dunkel + mobil
gesichtet, PM2-Logs sauber, Commit + Push.
