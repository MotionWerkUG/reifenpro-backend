# Nullstellung Rechnungswesen vor Aufnahme des Geschäftsbetriebs

**Datum:** 2. September 2026 · **Veranlasst von:** Inhaber · **Ausgeführt von:** Bereich Rechnungswesen

Der Betrieb wird zum 1. Oktober 2026 eröffnet. Ab dem 2. September 2026 werden über die
Website Termine angenommen; Leistungen werden noch nicht erbracht und keine Rechnungen
gestellt. Vor diesem Übergang wurde das Rechnungswesen auf einen definierten Nullstand
gebracht, damit die Bücher ab dem ersten Geschäftsvorfall lückenlos und unverändert sind.

## Ausgangslage

Aus der Entwicklungs- und Testphase stammten:
- ein Rechnungsentwurf vom 29.08.2026 über 111,97 € (Testdaten des Inhabers), verknüpft mit
  einem Termin
- vier Positionen zu diesem Entwurf
- zwei PDF-Dateien im Belegordner (`RE-2026-0001.pdf`, `RE-2026-0002.pdf`) aus einem
  QA-Durchlauf, Aussteller „Schroeder Scholz QA", ohne jeden Datensatz in der Datenbank

**Festgeschriebene oder stornierte Rechnungen gab es zu keinem Zeitpunkt.** Der Nummernkreis
`rechnung_counter` war durchgehend leer, es wurde also nie eine Rechnungsnummer vergeben.

## Durchgeführt

1. Die beiden QA-PDF-Dateien wurden am 02.09.2026 aus dem Belegordner **verschoben, nicht
   gelöscht** — nach `/var/backups/reifenpro/qa-artefakte-2026-09-02/` mit einem Hinweis zur
   Herkunft. Grund: Ihre Dateinamen hätten die ersten beiden echten Rechnungen überschrieben.
2. Der Entwurf und seine Positionen wurden in einer Transaktion entfernt. Zuvor wurde die
   Verknüpfung am Termin gelöst (`rechnung_id` auf NULL, `fakturiert` auf false), damit der
   Termin wieder abrechenbar ist — derselbe Weg, den auch die Anwendung geht.
3. Der Nummernkreis blieb unangetastet, weil er leer war. Die erste echte Rechnung erhält
   damit **RE-2026-0001**.

## Nachweis des Nullstands (2. September 2026)

| Prüfung | Ergebnis |
|---|---|
| Rechnungen in der Datenbank | 0 |
| Rechnungspositionen | 0 |
| Nummernkreis `rechnung_counter` | leer |
| Dateien im Belegordner `rechnungen/` | 0 |
| Termine fälschlich als abgerechnet markiert | 0 |

## Was bewusst NICHT gelöscht wurde

Das Änderungsprotokoll (`audit_log`) bleibt vollständig erhalten, einschließlich der beiden
Einträge zum Testentwurf. Ein Protokoll vor dem Start zu bereinigen, damit es makellos
aussieht, wäre das falsche Signal — es ist wahr, dass in der Testphase ein Entwurf existierte,
und diese Wahrheit gehört nachvollziehbar dokumentiert. Genau deshalb gibt es dieses Dokument.

## Ab jetzt gilt

- **Keine Testrechnungen mehr in der Produktivumgebung.** Tests laufen ausschließlich gegen
  die Testdatenbanken (`npm run test:db`, `npm test`) oder eine eigene Prüfumgebung.
- Ab dem ersten festgeschriebenen Beleg greift die Unveränderbarkeit: keine Löschung, keine
  Rückdatierung, Korrekturen ausschließlich über eine Stornorechnung mit eigener Nummer.
- Der Belegordner ist aufbewahrungspflichtig (acht Jahre). Er wird täglich gesichert und
  einmal je Monat dauerhaft archiviert.

## Offen vor dem 1. Oktober

- Kontenplan vom Steuerberater bestätigen (Vorlage liegt vor).
- Für die Kasse: eigener fiskaly-Zugang mit produktiver TSE, Bereinigung der Testbelege in
  der Kasse **vor** deren erster Echtbuchung, Meldung nach § 146a Abs. 4 AO über ELSTER.
- Dem Datenbankbenutzer das Recht entziehen, die Rechnungstabellen zu leeren (`TRUNCATE`
  umgeht den Löschschutz, weil dabei keine Trigger auslösen).
