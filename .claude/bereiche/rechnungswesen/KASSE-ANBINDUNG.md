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

## Analyse der vorhandenen Kasse (29.08.2026)

**Zwei Firmen bestätigt** — ReifenPro ist nicht dieselbe Firma wie der Autohandel. Damit:
eigene Instanz, eigene Datenbank, eigener Nummernkreis, eigene TSE, eigene ELSTER-Meldung.

**Kopieren oder zweite Instanz?** Die Kasse ist NICHT mandantenfähig (kein `mandant_id`,
ein Firmendatensatz je Datenbank) — eine zweite Instanz ist also zwingend und funktioniert:
Auf dem Server läuft bereits eine zweite (`kassen-baukasten`, eigener Dienst, Port, DB).
Der Code selbst sollte aber **nicht** kopiert werden. Beleg: Genau diese Kopie ist in fünf
Wochen um rund 600 Zeilen auseinandergelaufen und hat zwei komplette Module verloren —
darunter den DATEV-Export. Jede Kopie trägt alle Pflichten nach § 146a AO und GoBD doppelt.

**Was schon Konfiguration ist:** Firma, Kontenrahmen, Warengruppen, Standorte, Kassenplätze,
Module, Branchen-Preset (es gibt „Werkstatt/Handwerk"), Beschriftung des Referenzfelds,
Preismodus brutto.

**Was fest verdrahtet und für uns falsch ist** (gehört als Konfiguration in die EINE Codebasis):
1. Die ERP-Schnittstelle spricht Autohandel: Betragsarten Anzahlung/Kaution/Kaufpreis und
   Steuerarten M/K/F/B stehen als Text im Code. Sendet ReifenPro „Montage", fällt es
   stillschweigend in den letzten Zweig und bucht eine **Anzahlung** — ein falscher
   Buchungssatz, den man erst beim Steuerberater bemerkt.
2. Der Schnittstellenweg kann nur **Bar**. EC-Zahlung ist nicht vorgesehen.
3. Freie Buchungen verlangen zwingend eine Ticketnummer — eine Härtung für den Autohandel,
   die bei uns die Kasse blockieren würde.
4. Im Steuerexport steht fest „FIN" statt des konfigurierten Referenzfelds.
5. Der mitgelieferte Kontenplan ist reiner Autohandel (Fahrzeugankauf, § 25a). Wir brauchen
   einen eigenen.

**Zahlungsvermerke und Bonablage** (die Frage des Inhabers): Es gibt keinen Schalter
„bezahlt" — die Zahlung IST die Buchung, erkennbar am Gegenkonto (Kasse 1000, EC 1360,
Forderung 1400). Teilzahlungen werden je Steuersatz und Zahlart aufgeteilt, auf den Cent
genau. Der Bon liegt **nirgends als Datei**: Er ist die Menge der Buchungszeilen mit
derselben Belegnummer und entsteht daraus dreifach — auf Papier, als digitaler Beleg über
eine signierte Adresse ohne Anmeldung, und im Steuerexport. Die Aufbewahrung erzwingt die
Datenbank selbst: Löschen verboten, Ändern nur für Storno-Kennzeichen und die
TSE-Nachsignierung. Storno erzeugt immer eine Gegenbuchung über den ganzen Beleg.

**TSE:** heute eine Test-TSE, Leipzig hängt behelfsweise an der TSS eines Demo-Standorts.
In der Datenbank steht **keine einzige Buchung** — günstigster denkbarer Zeitpunkt. Vor dem
Echtbetrieb: Live-Vertrag, eigene TSS je Standort, Seriennummern eintragen, ELSTER-Meldung
binnen eines Monats. Ob zwei Firmen an derselben Cloud-TSE hängen dürfen, ist eine Frage an
den Steuerberater — die vorsichtige Empfehlung ist: getrennt, wie die Buchführung.

## Die eine Sache, die heute nicht geht

**Ein Zahlungseingang auf eine ReifenPro-Rechnung ist an der Kasse nicht buchbar.** Der
vorhandene Forderungsausgleich funktioniert ausschließlich gegen Forderungen, die die Kasse
selbst gebucht hat; eine fremde Rechnungsnummer kennt sie nicht. Der einzige heutige Umweg
würde einen **Erlös** buchen statt eines Ausgleichs — dann stünde der Umsatz doppelt, einmal
bei der Rechnungsstellung und einmal bei der Zahlung. Genau der Fall „Kunde zahlt später
bar" braucht also einen neuen Endpunkt in der Kasse. Das ist der größte Einzelposten.

## Weitere Lücken der Schnittstelle

- Die Betragsart kommt nur als Textpräfix im Buchungstext zurück, nicht als eigenes Feld.
- Kein Storno-Signal: Stornos sieht man nur, wenn man die Gegenbuchungen auswertet.
- Kein Filter auf dem Export (kein Zeitraum, kein Vorgang) — der Erstlauf holt immer alles.
- Das ERP kann einen offenen Kassenvorgang nicht zurückziehen. Storniert ReifenPro einen
  Termin, blockiert der offene Vorgang den Tagesabschluss, bis ihn jemand von Hand ablehnt.
- Drei Stolperstellen beim Anlegen eines Vorgangs: die Idempotenz greift nur mit gesetzter
  Belegnummer, ein bereits bestätigter Vorgang antwortet mit Erfolg ohne Kennung, und ein
  gesendeter Steuersatz wird durch den des getroffenen Kontos überschrieben.

## Aufwand

Einrichtung der Instanz etwa ein Tag, dazu Wartezeiten für fiskaly-Vertrag und Kontenplan.
Echte Codeänderungen etwa fünf bis acht Tage, größter Posten der Kopplungsendpunkt.

## Reihenfolge

1. Fachliches festschreiben, bevor Code entsteht: Betragsarten, Erlöskonten, Leitmerkmal,
   Belegaufteilung. Kontenplan mit dem Steuerberater. Ergebnis: eigene Vertragsdatei.
2. Die vier verdrahteten Stellen in der EINEN Codebasis konfigurierbar machen — jetzt, wo
   der Autohandel noch null Buchungen hat.
3. Instanz einrichten, noch mit Test-TSE, komplett durchspielen.
4. Kopplungsendpunkt für den Zahlungseingang bauen.
5. Prüf-Agenten, Release-Gate.
6. Live-TSE, Bereinigung der Testbuchungen, erste Echtbuchung, ELSTER-Meldung.

## Entscheidungen des Inhabers vom 29.08.2026 (nachmittags)

- **Großkunden zahlen per Überweisung**, nicht bar. Damit ist der Fall „Barzahlung auf eine
  offene Rechnung" fast bedeutungslos: Eine Überweisung berührt die Kasse nie, sie wird vom
  Steuerberater aus dem Kontoauszug gebucht. In ReifenPro wird die Rechnung schlicht als
  bezahlt markiert. **Der aufwendige Kopplungsendpunkt entfällt damit vorerst.**
- **Gewünschter Ablauf:** Eine Rechnung aus ReifenPro erscheint in der Kasse als offener
  Kassenvorgang; der Inhaber wählt ihn aus und bucht „Betrag erhalten". Das ist genau der
  vorhandene Mechanismus (`POST /api/kassenvorgang` → Reiter „Kassenvorgänge" → bestätigen).
- **Wertgutscheine sind nicht geplant.** Fällt aus dem Umfang.
- **Der Kassen-Baukasten wurde nie weitergeführt.** Damit ist `autokasse` der Master; die
  Kopie im Archiv ist tot und der zugehörige Dienst gehört abgeschaltet.

## Was der gewünschte Ablauf heute schon kann — und was fehlt

Geprüft am Code (`bucheKassenvorgang`, server.js):

- Das mitgesendete Feld `konto` hat **Vorrang** vor der Ableitung. Schickt ReifenPro
  `konto: "1400"` (Forderungen), bucht die Kasse **Kasse an Forderungen** — genau richtig
  für einen Zahlungseingang, ohne neuen Umsatz.
- Der Steuersatz wird dabei auf 0 gesetzt, wenn der getroffene Kontoschlüssel 0 % führt.
  Auch richtig: Die Umsatzsteuer ist mit der Rechnung entstanden, nicht mit der Zahlung.
- **Was fehlt:** Die Vorgangsart kommt aus der fest verdrahteten Zuordnung und wäre
  „Anzahlung". Im Steuerexport (DSFinV-K) stünde damit „Anzahlungseinstellung" statt
  „Forderungsauflösung". Der Geschäftsvorfalltyp `Forderungsaufloesung` existiert bereits —
  es fehlt nur die Möglichkeit, ihn über die Schnittstelle zu wählen. Das ist eine der vier
  ohnehin nötigen Konfigurierbarkeits-Änderungen, kein neuer Endpunkt.

Ergebnis: Der gewünschte Ablauf ist **fast vollständig mit dem Vorhandenen abbildbar**.

## Barzahlung direkt aus ReifenPro melden — möglich und zulässig

Der Inhaber steht beim Kassieren ohnehin am Rechner. Ein Knopf „bar erhalten" an der
Rechnung, der die Zahlung sofort an die Kasse meldet, ist zulässig — dafür ist die
ERP-Schnittstelle da. Drei Bedingungen:

1. **Sofort buchen und signieren.** Die Aufzeichnung muss unmittelbar erfolgen (§ 146a AO,
   Einzelaufzeichnung). Der heutige Zweischritt „offen → später bestätigen" stammt aus dem
   Autohandel, wo eine zweite Person bestätigt. Für den Einmannbetrieb sollte die Meldung
   direkt buchen, nicht in einer Liste warten.
2. **Der Kunde bekommt einen Beleg der Kasse** — mit den TSE-Angaben (§ 6 KassenSichV).
   Eine ReifenPro-Rechnung allein genügt dafür nicht, solange sie diese Angaben nicht trägt.
3. **Kein zweiter Umsatz.** Gab es die Rechnung schon, bucht die Kasse gegen Forderungen;
   gab es sie nicht, bucht sie den Erlös und ReifenPro schreibt keine zweite Rechnung.

## Offene Punkte — Entscheidungen des Inhabers

1. ~~Dieselbe Firma?~~ **Beantwortet: nein, zwei Firmen.** Damit ist die Trennung gesetzt.
2. Soll die Laufkundschaft standardmäßig nur einen Kassenbeleg bekommen, oder immer
   zusätzlich eine Rechnung?
3. Ab wann wird bar kassiert (Gründungsdatum)? Davon hängt die ELSTER-Meldung ab, die
   binnen eines Monats nach Anschaffung des Systems zu erfolgen hat.
4. Welche Erlöskonten gelten (SKR03/SKR04)? Aktuell sind im Rechnungswesen 8400 für 19 %
   und 8300 für 7 % hinterlegt, Debitor 1400.
5. Kassennachschau und Verfahrensdokumentation: Die Kasse bringt ihre eigene mit. Der
   Betrieb braucht eine gemeinsame, die beide Systeme und ihre Schnittstelle beschreibt.

## Was NICHT gebaut wird, bevor das Fachliche steht

Kein Code. Eine falsch aufgesetzte Kassenanbindung erzeugt fiskalische Belege, die sich
nicht mehr zurücknehmen lassen — anders als eine Rechnung im Entwurf. Konkret fehlen noch
die Betragsarten, die Erlöskonten (mit dem Steuerberater) und das Leitmerkmal.

## Nebenbefund zum Aufräumen

Der Dienst `kassen-baukasten` läuft seit vier Wochen aus einem Verzeichnis, das inzwischen
nach `_archiv` verschoben wurde. Bevor eine dritte Instanz auf denselben Server kommt,
gehört er gestoppt und abgeschaltet — sonst wird bei der nächsten Portvergabe geraten
statt gewusst.
