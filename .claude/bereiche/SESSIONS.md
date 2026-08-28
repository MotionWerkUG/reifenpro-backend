# Sessions & Bereiche — immer die richtige Session ansprechen

Mehrere Claude-Code-Sessions arbeiten parallel an ReifenPro (je Bereich ein eigener
git-Worktree). Der **Peer-Name** einer Session (z. B. `reifenpro-92`) wird vom System
vergeben und **ändert sich bei Neustart/Resume** — deshalb zeigt eine veraltete Namens-
Zuordnung schnell auf eine tote Session. Diese Datei löst das über zwei Hebel.

## 1. Feste Namen pro Bereich (Hauptlösung)

Jede Session soll beim Start einen **festen, sprechenden Namen** bekommen — dann ändert
sich der Name gar nicht mehr (außer bei einem echten Doppelstart, dann vergibt Claude
Code eine Variante wie `-92`).

| Bereich | Worktree | Fester Name (Konvention) |
|---|---|---|
| Homepage/CMS | `reifenpro-homepage` | `reifenpro-homepage` |
| Kundenportal/Gast | `reifenpro-portal` | `reifenpro-portal` |
| Admin/Werkstatt | `reifenpro-admin` | `reifenpro-admin` |
| Rechnungswesen | `reifenpro-rechnungen` | `reifenpro-rechnungen` |
| Integration/Deploy | `reifenpro` (main) | `reifenpro-main` |

Namen setzen — eine der beiden Varianten:
- Beim Start: `claude --name reifenpro-homepage` (im jeweiligen Worktree).
- In einer laufenden Session: `/rename reifenpro-homepage`.

Hinweis: Ein fester Name wird nach einem Neustart NICHT automatisch wiederhergestellt —
beim (Neu-)Start erneut `--name` angeben bzw. `/rename` ausführen.

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
