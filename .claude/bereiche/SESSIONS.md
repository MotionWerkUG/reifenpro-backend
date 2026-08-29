# Sessions & Bereiche — immer die richtige Session ansprechen

Mehrere Claude-Code-Sessions arbeiten parallel an ReifenPro (je Bereich ein eigener
git-Worktree). Der **Peer-Name** einer Session (z. B. `reifenpro-92`) wird vom System
vergeben und **ändert sich bei Neustart/Resume** — deshalb zeigt eine veraltete Namens-
Zuordnung schnell auf eine tote Session. Diese Datei löst das über zwei Hebel.

## Zuständigkeiten — was gehört in welche Session (verbindlich)

Eine Sparte pro Session. Was nicht dein Bereich ist, gib an die zuständige Session weiter.

| Bereich (Session-Name) | Zuständig für |
|---|---|
| `homepage` | Öffentliche Website + CMS: homepage-render/generate, cms.html, Coming-Soon, Buchungs-Frontend `/termin/`, Preisseite `/preise/`, Bild-Pipeline (sharp) + Darstellung der Bilder auf der Website |
| `portal` | Kundenportal + Gast-Buchung (Backend): portal.html, gast.js, portal-auth/-daten, Registrierung/Login/Reset, Gast-Termin, Bestätigungs-/Kundenmails, öffentliche Gutschein-Prüfung, buchbar_ab-Ausgabe |
| `admin` | Admin/Werkstatt-App: frontend/index.html, Dashboard/Kunden/Einlagerung/Lager/Kalender/Werkstatt, Artikel-CRUD + Preise + online-buchbar/rolle, Einstellungen/Firmendaten, DSGVO, Mitarbeiter, termine.js |
| `rechnungswesen` | **Rechnungswesen = „Rechnungen" (EIN Bereich):** rechnungen.js, Rechnung aus Termin, GoBD/§14, Nummernkreis, PDF, Storno, Export/DATEV, Belege-Aufbewahrung/Backup |
| `reifenpro-main` | Nur Integration/Deploy: main mergen, `sudo pm2 restart reifenpro`. Kein Entwickeln. |

### Routing bei Überschneidungen (Beispiele)
- **Gutschein:** Feld/Anzeige im `/termin/` = homepage · Prüf-Endpunkt + Speichern am Termin = portal · Anzeige im Admin = admin · Rabatt auf der Rechnung = rechnungen.
- **Leistung online schalten:** online-buchbar/rolle/aktiv = admin (Quelle) · Bild/Titel/Sortierung + Website-Darstellung = homepage.
- **Bild-Upload:** Endpunkt + sharp-Pipeline = homepage (homepage.js) · die Admin-UI, die ihn aufruft = admin.
- **Backend-Deploy:** Bereichs-Branch → main mergen → `sudo pm2 restart reifenpro` (läuft aus dem Hauptordner).

## 0. Warum das überhaupt ein Problem ist (Stand 2026-08-29)

Drei Tatsachen, die zusammen das ganze Durcheinander erklären:

1. **Der Name gehört zum Prozess, nicht zum Ordner.** Er ist Ordnername + Zufallssuffix
   (`admin-35`, `admin-1e`). Jeder Start, jedes Resume, jedes Neuverbinden erzeugt einen
   neuen Prozess und damit einen neuen Suffix — auch mitten in der Arbeit.
2. **Ein Fenster schließen beendet die Session NICHT.** Der Prozess läuft weiter, bleibt in
   `ListAgents` sichtbar und ansprechbar — und kann weiter in die Dateien des Worktrees
   schreiben. Am 29.08.2026 liefen so 60 Sessions gleichzeitig, 13 davon älter als eine
   Woche, die älteste seit 21 Tagen.
3. **Worktrees trennen Bereiche, nicht Prozesse.** Zwei Sessions im selben Worktree teilen
   sich dieselben Dateien. Genau das ist in der Nacht auf den 29.08. passiert: zwei
   Instanzen desselben Admin-Strangs, beide mit demselben Arbeitsstand.

Konsequenz für jede Session: Ein Peer-Name in einer Notiz von gestern ist wertlos. Vor dem
Anschreiben immer `ListAgents`, und bei Zweifeln die Gegenseite nach ihrem Worktree und
ihrem `git status` fragen, statt dem Namen zu glauben.

### Schutz beim Start (automatisch)

Der `SessionStart`-Hook speichert jetzt zusätzlich die **PID** des Sitzungsprozesses. Startet
eine zweite Session in einem Worktree, in dem laut Registry schon eine **lebende** Session
sitzt, schreibt der Hook eine deutliche Warnung in den Sitzungskontext: PID, Laufzeit und
was zu tun ist (Gegenseite fragen, mit David klären, nicht parallel committen). Das ersetzt
kein Aufräumen, macht die Doppelbelegung aber in der ersten Sekunde sichtbar.

## 1. Feste Namen pro Bereich (Hauptlösung)

Jede Session soll beim Start einen **festen, sprechenden Namen** bekommen — dann ändert
sich der Name gar nicht mehr (außer bei einem echten Doppelstart, dann vergibt Claude
Code eine Variante wie `-92`).

| Bereich | Worktree | Fester Name (Konvention) |
|---|---|---|
| Homepage/CMS | `homepage` | `homepage` |
| Kundenportal/Gast | `portal` | `portal` |
| Admin/Werkstatt | `admin` | `admin` |
| Rechnungswesen | `rechnungswesen` | `rechnungswesen` |
| Integration/Deploy | `reifenpro` (main) | `reifenpro-main` |

Namen setzen — eine der beiden Varianten:
- Beim Start: `claude --name homepage` (im jeweiligen Worktree).
- In einer laufenden Session: `/rename homepage`.

Hinweis: Ein fester Name wird nach einem Neustart NICHT automatisch wiederhergestellt —
beim (Neu-)Start erneut `--name` angeben bzw. `/rename` ausführen. Ohne `--name` vergibt
Claude Code wieder einen Zufallssuffix, und dann sind zwei Admin-Sessions in der Liste nicht
mehr auseinanderzuhalten.

**Beenden gehört dazu:** Eine Session, die nicht mehr gebraucht wird, mit `/exit` beenden —
nicht nur das Fenster schließen. Sonst bleibt sie als Geist zurück (siehe Abschnitt 0).

## 2. Automatische Registry (Absicherung)

Ein `SessionStart`-Hook trägt bei **jedem** (Neu-)Start automatisch ein, welche Session
gerade in welchem Bereich aktiv ist; `SessionEnd` markiert sie als beendet.

- Registry (Laufzeit, gitignored): `/home/deploy/projekte/reifenpro/.claude/session-registry.json`
- Hooks: `.claude/hooks/register-session.sh` / `unregister-session.sh`
- Konfiguriert in `.claude/settings.json` (committet, projektweit).

Schlüssel ist der **Bereich** (aus dem Worktree-Pfad abgeleitet: `homepage`, `portal`,
`admin`, `rechnungen`, `main`) — der ist stabil, der Peer-Name nicht. Registry lesen:

```bash
jq . /home/deploy/projekte/reifenpro/.claude/session-registry.json
```

Wichtig: Der Hook kennt den öffentlichen Peer-Namen NICHT (Claude-Code-Einschränkung),
nur `session_id` + Bereich. Der Peer-Name ergibt sich aus der Namenskonvention (Hebel 1).

## 3. Vor dem Anschreiben — so findest du die richtige Session

1. `ListAgents` aufrufen: zeigt die aktuell **lebenden** Peer-Namen.
2. Bei festen Namen (Hebel 1) ist die Zuordnung direkt klar (`reifenpro-<bereich>`).
3. Bei einer Variante/Unklarheit: Registry lesen (welcher Bereich zuletzt gestartet ist),
   und mit den lebenden Namen aus `ListAgents` abgleichen.
4. Hat sich dein eigener Name geändert, sag es den anderen Sessions einmal per
   `SendMessage` (das bleibt manuell — es gibt kein Broadcast-Ereignis in Claude Code).

## Was NICHT geht (bewusst dokumentiert)

- Es gibt **kein** Umbenennungs-Ereignis und **keinen** Shell-Broadcast. Ein Hook kann
  andere Sessions nicht automatisch benachrichtigen und kennt den eigenen Peer-Namen
  nicht. Deshalb: feste Namen + Registry statt „Push bei Umbenennung".

## Aktivierung

Hooks greifen erst nach einem **Neustart** der jeweiligen Session (bzw. nach einmaligem
Öffnen von `/hooks`, das die Konfiguration neu lädt).
