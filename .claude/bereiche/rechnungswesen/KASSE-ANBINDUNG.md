# AutoKasse-Anbindung für ReifenPro — Entwurf

Stand 29.08.2026. Grundlage: `/home/deploy/projekte/_koordination/CONNECTOR-VERTRAG.md`
(Fassung Carventory) und der Code von AutoKasse. **Noch kein Vertrag** — offene Punkte
unten brauchen Entscheidungen des Inhabers.

## Ausgangslage

Ab dem ersten Geschäftstag wird bar kassiert. Damit gilt § 146a AO vollständig: zertifizierte
Sicherheitseinrichtung, Belegausgabe ab dem ersten Bargeschäft, Kassennachschau, Meldung über
ELSTER. AutoKasse erfüllt das bereits (fiskaly-TSE gültig bis 2033, DSFinV-K 2.4,
Belegausgabe mit TSE-Angaben, GoBD-Protokoll). Eine eigene Kassenlösung in ReifenPro zu bauen
wäre grob fahrlässig — die Kasse wird angebunden, nicht nachgebaut.

**Die eigentliche Gefahr ist nicht die Technik, sondern die doppelte Belegerzeugung.**
AutoKasse kann selbst Rechnungen schreiben (Modul `rechnung`, sogar E-Rechnung nach
EN 16931). ReifenPro kann es auch. Schreiben beide, steht derselbe Umsatz zweimal in der
Buchhaltung, mit zwei Nummernkreisen. Das muss die Anbindung ausschließen.

## Vorgeschlagene Aufteilung

| Fall | Beleg | System |
|---|---|---|
| Laufkundschaft zahlt sofort bar | Kassenbeleg mit TSE | AutoKasse allein. ReifenPro erzeugt KEINE Rechnung. |
| Kunde will zusätzlich eine Rechnung | Rechnung mit Hinweis „bar bezahlt, Kassenbeleg Nr. …" | ReifenPro, mit Verweis auf den Kassenbeleg — kein zweiter Umsatz |
| Gewerbekunde auf Rechnung | Rechnung | ReifenPro allein, Kasse unbeteiligt |
| Später bar bezahlt | Zahlungseingang auf die offene Rechnung | AutoKasse bucht gegen die ReifenPro-Belegnummer |

Kurz: **Die Kasse ist die Zahlungs- und Fiskalschicht, ReifenPro bleibt das Rechnungssystem.**
Belege entstehen nur an einer Stelle je Vorgang.

## Technischer Weg (Mechanismus aus dem bestehenden Vertrag)

Wiederverwendbar und unverändert:
- `POST /api/kassenvorgang` — ReifenPro meldet einen Vorgang an die Kasse.
  Idempotent über `quelleBeleg`; ein Doppelklick erzeugt keinen zweiten Vorgang.
- `GET /api/export/verkaeufe?limit=&cursor=` — ReifenPro holt bestätigte Buchungen ab,
  Cursor über `seq`.
- Authentisierung beidseitig über den Kopf `X-ERP-Key`, Schlüssel nur in `.env`.

Fachlich NEU für ReifenPro (nicht vom Autohandel übernehmen):
- `betragArt`: statt Anzahlung/Kaution/Kaufpreis → **Montage, Einlagerung, Reifenkauf,
  Zubehör, Anzahlung**.
- `steuerart` und Kontenzuordnung: eigene Erlöskonten. Keine Differenzbesteuerung nach
  § 25a — die gibt es im Reifenservice nicht.
- Leitmerkmal: beim Autohandel Fahrzeug/Vertrag. Hier **Termin-Nummer**, hilfsweise
  Kennzeichen. Wichtig: Bei Gast-Terminen gibt es keinen Kundendatensatz, nur einen
  Kontaktdaten-Schnappschuss — die Schnittstelle muss ohne `kunden_id` auskommen.
- **Eigene Kassen-Instanz** mit eigenem Schlüssel und eigener Datenbank, kein gemeinsamer
  Datentopf mit dem Autohandel.

## Offene Punkte — Entscheidungen des Inhabers

1. **Ist ReifenPro dieselbe Firma wie die, für die AutoKasse und Carventory heute laufen?**
   Der wichtigste Punkt. Eine Firma bedeutet eine Buchführung und einen durchgehenden
   Umsatz; zwei Firmen bedeuten getrennte Instanzen, getrennte Nummernkreise, getrennte
   Bücher. Alles Weitere hängt daran.
2. Soll die Laufkundschaft standardmäßig nur einen Kassenbeleg bekommen, oder immer
   zusätzlich eine Rechnung?
3. Ab wann wird bar kassiert (Gründungsdatum)? Davon hängt die ELSTER-Meldung ab, die
   binnen eines Monats nach Anschaffung des Systems zu erfolgen hat.
4. Welche Erlöskonten gelten (SKR03/SKR04)? Aktuell sind im Rechnungswesen 8400 für 19 %
   und 8300 für 7 % hinterlegt, Debitor 1400.
5. Kassennachschau und Verfahrensdokumentation: Die Kasse bringt ihre eigene mit. Der
   Betrieb braucht eine gemeinsame, die beide Systeme und ihre Schnittstelle beschreibt.

## Was NICHT gebaut wird, bevor Punkt 1 geklärt ist

Kein Code. Eine falsch aufgesetzte Kassenanbindung erzeugt fiskalische Belege, die sich
nicht mehr zurücknehmen lassen — anders als eine Rechnung im Entwurf.
