# Was vor dem 1. Oktober 2026 erledigt sein muss

Stand 07.09.2026. Geprüft am laufenden System gegen eine Kopie der echten Produktionsdaten
(isolierte Instanz, danach entfernt) — nicht aus dem Code abgeleitet, sondern gemessen.

## Auf einen Blick: Was am 1. Oktober fehlen würde

Keiner dieser Punkte lässt sich durch Programmieren lösen. Alle brauchen eine Entscheidung
oder eine Beschaffung, und zwei davon haben Vorlaufzeit.

| # | Was fehlt | Folge am ersten Tag | Vorlauf |
|---|---|---|---|
| 1 | Steuernummer oder USt-IdNr. | **Keine Rechnung kann festgeschrieben werden** | Finanzamt |
| 2 | Rechtsform in den Firmendaten | Beleg weist Vertretung falsch aus (§ 35a GmbHG) | sofort erledigbar |
| 4a | Live-TSE bei fiskaly | **Keine Barzahlung erfassbar** (§ 146a AO) | Beschaffung, Tage bis Wochen |
| 4b | Kontenbestätigung Steuerberater | Konten stehen nach der ersten Buchung TSE-signiert fest | Termin nötig |
| 4c | ELSTER-Meldung der Kasse | Meldepflicht verletzt (§ 146a Abs. 4 AO) | nach TSE |
| 4d | Zwei Zeilen in der `.env` | Kassieren-Schaltflächen bleiben unsichtbar | Minuten |

Punkt 1 blockiert das Rechnungswesen, Punkt 4a das Bargeldgeschäft. Da ab dem ersten Tag
Bargeld angenommen wird, sind beide gleich hart.

Der Code ist bei keinem dieser Punkte die Ursache — er ist gebaut, geprüft und wartet.

## Blockierend: Ohne diese Punkte kann keine Rechnung entstehen

### 1. Steuernummer oder USt-IdNr. fehlt

In den Firmendaten sind **beide Felder leer**. Nachgestellt mit den echten Einstellungen:

    POST /api/rechnungen/:id/festschreiben
    -> 400 "Bitte zuerst Steuernummer oder USt-IdNr. in den Einstellungen hinterlegen (§ 14 UStG)."

Das ist gewolltes Verhalten — eine Rechnung ohne diese Angabe wäre nach § 14 Abs. 4 Nr. 2 UStG
unvollständig und berechtigt den Kunden nicht zum Vorsteuerabzug. Aber es heißt: **Am ersten
Arbeitstag ließe sich nicht abrechnen.**

Zu hinterlegen unter Einstellungen → Firmendaten. Eine Platzhalter-Nummer ist keine Lösung: Sie
erzeugt eine formal vollständige, inhaltlich falsche Rechnung. Lieber die Sperre.

### 2. Rechtsform ist nicht gesetzt

Der Firmenname trägt „UG (haftungsbeschränkt) i.G.", das Feld `rechtsform` ist leer. Davon
hängt ab, ob der Beleg „Geschäftsführer:" oder „Inhaber:" ausweist und ob eine
vertretungsberechtigte Person verlangt wird. Bei einer UG ist die Angabe des Geschäftsführers
nach § 35a GmbHG Pflicht auf Geschäftsbriefen.

Solange „i.G." (in Gründung) gilt: Das ist zulässig, muss aber so auf dem Beleg stehen. Nach
Eintragung ins Handelsregister sind Registergericht und HRB-Nummer nachzutragen.

## Weitere Punkte, nach Dringlichkeit

### 3. Aktives Testkonto mit Mitarbeiterrechten

`werkstatt-test@intern.local` ist in der Produktion **aktiv** und hat die Rolle Mitarbeiter.
Zwei weitere Testkonten (`qa-admin@test.local`, `ui-test@intern.local`) sind inaktiv und damit
unkritisch.

In der Entwicklungsphase ist das gewollt. Ab dem ersten Geschäftstag ist es ein
Zugang zu echten Kunden- und Rechnungsdaten, der keiner Person zugeordnet ist — im
Änderungsprotokoll steht dann ein Benutzer, den niemand verantwortet. Vor dem 1. Oktober
entweder deaktivieren oder einer realen Person zuordnen. Gehört nicht mir allein: Andere
Bereiche nutzen die Testkonten für Oberflächentests.

### 4. Kassenanbindung: der Code ist fertig, die Voraussetzungen fehlen

Stand 09.09.2026. Bargeld wird ab dem ersten Tag angenommen — das hat der Inhaber entschieden.
Damit ist die Kasse kein Nachzügler, sondern Startbedingung.

Was steht: Die ReifenPro-Kasseninstanz läuft (Port 3004, eigene Datenbank). Unsere Seite ist
gebaut und getestet. Fehlt nur die Verdrahtung — zwei Zeilen in der `.env`:

    KASSE_URL=http://127.0.0.1:3004
    KASSE_ERP_KEY=<Schlüssel aus /root/.reifenpro-kasse-erpkey>

Solange sie fehlen, bleiben die Kassieren-Schaltflächen ausgeblendet. Das ist so gebaut: Eine
halbe Anbindung ist gefährlicher als gar keine.

**Der eigentliche Blocker ist ein anderer — und er liegt nicht im Code:**

| Was | Wer | Ohne das |
|---|---|---|
| **Live-TSE bei fiskaly** (laut Kassen-Sitzung derzeit komplett aus) | Inhaber | Jede Barbuchung wäre unsigniert — Verstoß gegen § 146a AO |
| **Bestätigung der sieben Konten** durch den Steuerberater | Inhaber | Belege tragen ihr Konto nach der ersten Buchung TSE-signiert fest; eine Korrektur ist danach nur noch per Storno möglich |
| ELSTER-Meldung der Kasse (§ 146a Abs. 4 AO) | Inhaber | Meldepflicht verletzt |

Diese drei Punkte lassen sich nicht durch Programmieren lösen. Sie brauchen Vorlauf — eine
TSE-Beschaffung und ein Steuerberatertermin sind keine Sache von Stunden.

### 5. Erstattung nach Widerruf — geklärt, noch nicht gebaut

Der Fall: Ein Verbraucher widerruft wirksam, nachdem er bar bezahlt hat. Die Erstattung muss
über dasselbe Zahlungsmittel laufen, also über die Kasse.

Fachlich geklärt und von der Kassen-Sitzung bestätigt:

- **Kein Storno des ursprünglichen Kassenbelegs.** Ein Kassenstorno korrigiert eine fehlerhafte
  Erfassung. Ein Widerruf ist kein Fehler, sondern ein neuer Geschäftsvorfall — das Geld ist
  geflossen und später zurückgeflossen. Beides muss sichtbar bleiben (§ 146 Abs. 4 AO).
- **Eigener Vorgang, eigener Beleg, eigene TSE-Signatur.** Auch die Erstattung fällt unter die
  Belegausgabepflicht.
- **Keine neue Betragsart.** Die Erstattung spiegelt die ursprüngliche Buchung mit negativem
  Betrag. Hatte der Kunde eine Rechnung: Konto 1400, 0 % — die Steuer wird über die
  Stornorechnung korrigiert, nicht in der Kasse, sonst zweimal. War es ein Barverkauf ohne
  Rechnung: Konto 8400, 19 % — hier muss die Kasse die Steuer korrigieren, weil es keine
  Rechnung gibt, die es könnte.
- **Kartenzahlung** wird über die Karte erstattet, Konto 1360.

Offen, weil es Code-Änderungen auf der Kassenseite braucht und der Inhaber sie freigeben muss:

- Der Connector lehnt Beträge ≤ 0 heute ab.
- Vorgeschlagenes neues Feld `bezugQuelleBeleg`: Der Erstattungsvorgang verweist auf den
  ursprünglichen Beleg, damit die Prüfspur verbunden bleibt, ohne ein Storno zu sein.
- Die Geldwäsche-Schwelle zählt Erstattungen nicht mit — nur Zufluss, nicht Abfluss.

Erst nach der Freigabe wird der Connector-Vertrag auf v1.6 gehoben und unsere Seite gebaut.
Vorher wäre es Bauen gegen einen Vertrag, der noch nicht gilt.

### 6. Automatischer Storno bei Widerruf — Entscheidung steht aus

Rechnungswesen und Admin raten übereinstimmend ab. Ein Storno ist ein Beleg mit eigener Nummer
im fortlaufenden Nummernkreis; auf den Formularklick eines Unbekannten hin sollte keiner
entstehen, den niemand geprüft hat. Zumal nur EIN Widerrufsfall überhaupt einen Storno braucht:
gearbeitet ohne dokumentierte Zustimmung. Genau den soll die Zustimmungsabfrage am Termin
verhindern.

Solange der Inhaber nicht entschieden hat, wird dazu nichts gebaut.

### 7. Offene Punkte aus der Rechtsprüfung

- `TRUNCATE`-Recht des Datenbanknutzers entziehen
- Anfangsbestand buchen
- Sicherungskopie außerhalb des Servers (Hetzner Storage Box)

## Was geprüft und in Ordnung ist

Am laufenden System gegen eine Kopie der echten Daten durchgespielt:

| Prüfung | Ergebnis |
|---|---|
| Rechnung mit Endpreis 44,00 € | bleibt exakt 44,00 € (Netto 36,97 / Steuer 7,03) |
| Prüfsumme gegen die erzeugte Datei | stimmt überein |
| Storno | hebt Netto, Steuer und Brutto glatt auf null auf |
| Belegkette nach Storno | geschlossen |
| Belegdatei verändert | Anzeige 409, Versand 409, im Protokoll vermerkt |
| Anderer gültiger Beleg untergeschoben | ebenfalls abgewiesen |
| Beleg aus der Mitte gelöscht (Trigger umgangen) | Kettenbruch wird gemeldet |
| Löschen eines Belegs mit Storno-Bezug | zusätzlich durch Fremdschlüssel verhindert |
| Testinstanz gegen Testdatenbank | erkennt sich selbst, registriert keine Cron-Aufträge |

Die Produktion blieb dabei unberührt: 0 Rechnungen, Nummernkreis unbenutzt, Belegordner leer,
Firmendaten unverändert.
