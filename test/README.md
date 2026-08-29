# Tests Rechnungswesen

Automatisierte Tests für die rechtlich kritischen Teile der Rechnungsstellung:
Nummernkreis (fortlaufend, lückenlos, keine Doppelvergabe), § 14 UStG-Pflichtangaben,
Rundung/MwSt-Aufschlüsselung, Unveränderbarkeit und Storno.

## Einmalig: Test-Datenbank anlegen

```bash
npm run test:db
```

Legt `reifenpro_test` neu an — Schema 1:1 aus der Produktivdatenbank
(`pg_dump --schema-only`), aber **ohne Daten**. Braucht `sudo`-Rechte für den
Postgres-Superuser. Das Skript bricht ab, wenn der Zielname nicht als Testdatenbank
erkennbar ist (`test` im Namen) oder mit der Produktivdatenbank übereinstimmt.

Nach Schemaänderungen (neue Spalte, neuer Trigger) den Befehl erneut ausführen.

## Tests ausführen

Optional: `pdftotext` (Paket `poppler-utils`) — wird für die Prüfung des Storno-PDF-Inhalts
genutzt. Fehlt es, wird nur dieser Teilcheck übersprungen, die Tests laufen trotzdem durch.

```bash
npm test
```

Wichtig: Immer nur EIN Testlauf gleichzeitig. Alle Testdateien teilen sich `reifenpro_test`
und leeren die Tabellen per `TRUNCATE`; deshalb läuft `npm test` mit `--test-concurrency=1`.
Ein zweiter, parallel gestarteter Lauf (z. B. aus einer anderen Session) lässt beide
fehlschlagen — typischerweise mit `duplicate key users_email_key`.

Wenn wirklich zwei Läufe gleichzeitig nötig sind, bekommt der zweite eine eigene Datenbank:

```bash
TEST_DB_NAME=reifenpro_test2 npm run test:db && TEST_DB_NAME=reifenpro_test2 npm test
```

## Schutzmechanismen

- Verbindung geht ausschließlich auf `reifenpro_test`; `test/helper.js` prüft vor dem
  ersten Test per `current_database()` nach und bricht sonst ab.
- Erzeugte Rechnungs-PDFs landen in einem temporären Ordner
  (`RECHNUNGEN_DIR`), niemals im aufbewahrungspflichtigen Ordner `rechnungen/`.
- Es werden nur frei erfundene Testdaten verwendet, keine echten Kundendaten.
- Der produktive Nummernkreis (`rechnung_counter` in `reifenpro`) wird nicht berührt.

## Dateien

- `helper.js` — Testumgebung (Test-DB, Express-App nur mit den Rechnungs-Routen, Seeds, HTTP-Helfer)
- `nummernkreis.test.js` — Nummernvergabe, Nebenläufigkeit, Rückdatierung, Storno, Unveränderbarkeit
- `pflichtangaben.test.js` — § 14 UStG-Pflichtangaben, Kleinbetragsrechnung, Rundung, PDF-Inhalt, XRechnung
- `export.test.js` — Rechnungsjournal-CSV, DATEV-EXTF-Buchungsstapel, Funktionstrennung (Admin/Mitarbeiter)
- `aus-termin.test.js` — Rechnung aus Termin: Endpreis-Logik, Doppelabrechnung, Gast-Termin
- `haertung.test.js` — Nebenläufigkeit, Pflichtfeld- und Zahlenprüfung, Positionsgrenze, Mahnabstand
