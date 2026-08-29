# Wiederherstellung nach einem Ausfall

Geprüft am 29.08.2026 durch einen echten Restore in eine Wegwerf-Datenbank.
Gilt für die Sicherungen aus `scripts/backup.js` (täglich 03:00 per Cron).

## Was wo liegt

| Inhalt | Ort | Aufbewahrung |
|---|---|---|
| Datenbank (`reifenpro_*.sql.gz`) | `/var/backups/reifenpro`, nur root | 30 Tage |
| Monatsstand, dauerhaft | `/var/backups/reifenpro/dauerarchiv/` | wird nie rotiert |
| Dateien (`reifenpro-dateien_*.tar.gz`) | ebenda | 30 Tage |
| Datenbank verschlüsselt außer Haus | restic auf Hetzner Storage Box, via `offsite-backup.sh` | ca. 6 Monate |
| Wochenkopie per E-Mail (DB + Dateien) | Postfach des Inhabers, montags | solange das Postfach sie hält |

Im Datei-Archiv stecken `rechnungen/` (Rechnungs-PDFs), `protokoll-dateien/`
(unterschriebene Übergabeprotokolle, Fotos), `gewerbe-dokumente/` und `uploads/`
(Homepage-Bilder).

## Datenbank zurückspielen

Der Dump enthält **kein** `CREATE DATABASE` und kein `--clean`. Er gehört in eine frisch
angelegte, leere Datenbank — in eine bestehende eingespielt entsteht ein Trümmerfeld.

```bash
sudo -u postgres psql -c "CREATE DATABASE reifenpro_restore OWNER reifenpro_user;"
gunzip -c /var/backups/reifenpro/reifenpro_<Zeitstempel>.sql.gz | sudo -u postgres psql -d reifenpro_restore
```

Stolpersteine, alle beim Test bestätigt:
- Der Dump enthält `OWNER TO reifenpro_user`. **Die Rolle wird nicht mitgesichert** — auf
  einem neuen Server muss sie vorher existieren, sonst schlägt jedes dieser Statements fehl.
- `rechnungen.pdf_pfad` speichert **absolute** Pfade. Landet das Projekt an einem anderen
  Ort, zeigen alle PDF-Verweise ins Leere und müssen per `UPDATE` umgeschrieben werden.
- Der Dateiname trägt UTC. Ein Lauf um 03:00 Ortszeit heißt `…T01-00-01`.

Prüfen, ob es geklappt hat: Tabellenzahl (33), Sequenzen mit `setval` (der Rechnungsnummern-
Zähler muss mitkommen), Trigger (`trg_rechnung_schutz`, `trg_rechnung_pos_schutz`,
`trg_dokument_schutz`).

## Dateien zurückspielen

```bash
tar -tzf /var/backups/reifenpro/reifenpro-dateien_<Zeitstempel>.tar.gz | head
tar -xzf /var/backups/reifenpro/reifenpro-dateien_<Zeitstempel>.tar.gz -C /tmp/restore
```

Die Ordner liegen ohne ihren Elternpfad im Archiv. `rechnungen`, `protokoll-dateien` und
`gewerbe-dokumente` gehören nach `/home/deploy/projekte/reifenpro/`, der Ordner `uploads`
nach `/var/www/schroeder-homepage/`.

## Anwendung wieder hochfahren

```bash
sudo pm2 restart reifenpro
```

Nie `pm2 restart all` — der Prozess `sandumotion` gehört einem anderen Projekt.

## Was die Sicherung NICHT abdeckt

- **Noch keine Kopie außer Haus für die Belege.** Der Monatsstand liegt dauerhaft auf dem
  Server (`dauerarchiv/`), aber eine zweite Kopie an einem anderen Ort fehlt. Geplant ist
  eine Hetzner Storage Box; bis dahin gehen Rechnungs-PDFs und Protokolle nur als
  Mailanhang hinaus.
- **Belege liegen nicht verschlüsselt außer Haus.** Die Offsite-Sicherung umfasst nur
  Datenbanken; Rechnungs-PDFs und Protokolle gehen ausschließlich als Mailanhang hinaus.
- **Kein automatischer Restore-Test.** Andere Projekte auf dem Server haben einen, ReifenPro
  nicht. Wer die Sicherung nie zurückspielt, weiß nicht, ob sie taugt.
- **Die lokale Sicherung und der Mailanhang sind unverschlüsselt** und enthalten
  Passwort-Hashes, Kundendaten und Unterschriftsbilder.

Diese vier Punkte sind Entscheidungen des Inhabers, weil sie Cronjobs und fremde Skripte
betreffen — sie stehen im Release-Nachweis vom 29.08.2026 als offene Punkte.
