# Bereich: Rechnungswesen

Rechnungsstellung und Belege für Schröder & Scholz — rechtssicher (GoBD, Pflichtangaben nach
§ 14 UStG, fortlaufende Rechnungsnummer, Aufbewahrung 8 Jahre). Eigener Bereich, weil rechtlich
und logisch abgegrenzt. `DESIGN.md` gilt für die Optik.

## Dateien
- Backend: `src/routes/rechnungen.js` (CRUD, Festschreiben, Storno), `src/lib/rechnung-pdf.js`
  (PDF via pdfkit), `src/lib/preis.js` (Preis-/MwSt-Logik).
- Frontend: der **Rechnungen-Bereich in `frontend/index.html`** (geteilt mit Admin — bei
  Änderungen dort mit dem Admin-Bereich abstimmen).
- Daten: Ordner `rechnungen/` (PDFs, 8 Jahre aufbewahrungspflichtig — per .gitignore NICHT in Git).
- DB: `rechnungen`, `rechnung_counter` (Nummernkreis je Jahr), `kunden_preise`;
  DATEV-Felder in `einstellungen` (datev_*).

## Rechtliche Kernregeln
- **Fortlaufende, lückenlose Rechnungsnummer** RE-JJJJ-NNNN, atomar via `rechnung_counter`
  (`ON CONFLICT (jahr)` in Transaktion). Nie doppeln, nie überspringen.
- **§ 14 UStG-Pflichtangaben** vollständig (Aussteller, Leistungsempfänger, Datum,
  Leistungszeitraum, Menge/Art, Netto/MwSt-Satz/Betrag, Steuernummer/USt-IdNr).
- **Rechnungsdatum nicht rückdatierbar** (Audit S3) — beim Festschreiben serverseitig begrenzen.
- MwSt je Satz aggregiert, `round2` je Zeile; Client-Summen ignorieren.
- **Regelbesteuerung — vom Inhaber am 02.09.2026 ausdrücklich bestätigt, KEINE
  Kleinunternehmerregelung nach § 19 UStG.** Damit weist jede Rechnung Umsatzsteuer aus.
  Sollte sich das je ändern, ist es kein Schalter: Dann dürfte keine Steuer ausgewiesen
  werden, es bräuchte den Hinweis auf die Steuerbefreiung, und die Prüfung auf die Sätze
  19/7 müsste weichen.
- Storno als eigener Beleg, nicht Löschen.

## Deploy
Backend nach `src/…`, dann `pm2 restart reifenpro`. Frontend-Änderungen an der Rechnungen-
Ansicht: `scp frontend/index.html …/var/www/reifenpro/index.html` (mit Admin abstimmen).

## Tabus
Keine Rechnung/kein Beleg löschen oder rückdatieren. Nummernkreis-Logik nicht „vereinfachen".
Geteiltes Fundament nur nach Ankündigung. Keine echten Kundendaten in Tests.

## Tests
`npm run test:db` (einmalig / nach Schemaänderung) legt die Test-DB `reifenpro_test` an —
Schema 1:1 aus der Produktiv-DB, ohne Daten. `npm test` fährt die Tests
(`test/nummernkreis.test.js`, `test/pflichtangaben.test.js`). Tests laufen nie gegen die
Produktiv-DB und schreiben PDFs nur in einen Temp-Ordner (`RECHNUNGEN_DIR`). Details:
`test/README.md`. Nach jeder Änderung an `rechnungen.js` müssen die Tests grün sein.

## Konsistenzprüfungen (nach Löschläufen, vor Jahresabschluss)

Zwei Abfragen, die beide leer sein müssen. Wenn nicht, stimmt etwas mit der Belegkette nicht:

```bash
sudo -u postgres psql -d reifenpro -c "SELECT r.rechnungsnr, t.id AS termin FROM rechnungen r JOIN termine t ON t.rechnung_id = r.id WHERE t.beschreibung = '(anonymisiert nach Aufbewahrungsfrist)';"
```
Rechnung, deren Termin anonymisiert wurde — ein Beleg ohne nachvollziehbare Grundlage.

```bash
sudo -u postgres psql -d reifenpro -c "SELECT id, datum, kennzeichen FROM termine WHERE fakturiert = true AND rechnung_id IS NULL;"
```
Termin gilt als abgerechnet, hat aber keine Rechnung. Solche Zeilen fallen durch jedes
Raster: nicht unter „Abzurechnen", nicht unter die Löschfristen.

Nach Kassenzahlungen zusätzlich der Abgleich mit der Kasse. Jede Kassenbuchung mit der
Vorgangsart `zahlungseingang` muss eine Rechnung mit passender `kasse_beleg_nr` haben, und
umgekehrt. Buchungen der Kasse holt man über `GET /api/export/verkaeufe` mit dem Kopf
`X-ERP-Key`.

Wichtig bei der Auswertung: Eine Rechnung mit `zahlungsstatus='bezahlt'` OHNE Kassenbeleg
ist **kein** Fehler — sie kann per Überweisung bezahlt oder von Hand als bezahlt markiert
worden sein, und jede Stornorechnung trägt den Status ohnehin. Aussagekräftig ist nur der
Abgleich über die Belegnummern in beide Richtungen.

## Werkzeuge
`gobd-pruefer` (Pflicht bei jeder Änderung: Nummernkreis, § 14, Aufbewahrung, Rundung),
`code-auditor`, `reviewer`, `test-autor` (Preis-/MwSt-Logik). Vor Deploy `/release-gate`.
Verifikation: `../VERIFIKATION.md`.
