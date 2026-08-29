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
- Regelbesteuerung. Storno als eigener Beleg, nicht Löschen.

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

## Werkzeuge
`gobd-pruefer` (Pflicht bei jeder Änderung: Nummernkreis, § 14, Aufbewahrung, Rundung),
`code-auditor`, `reviewer`, `test-autor` (Preis-/MwSt-Logik). Vor Deploy `/release-gate`.
Verifikation: `../VERIFIKATION.md`.
