# Kontenplan und Betragsarten ReifenPro — Vorlage für den Steuerberater

Stand 29.08.2026. Reifenservice und Fahrzeugtechnik, Einzelunternehmen in Gründung,
Regelbesteuerung. Barzahlung ab dem ersten Tag, dazu EC-Karte und voraussichtlich Stripe.
Preise sind Bruttoendpreise.

Alles unten ist ein **Vorschlag zur Bestätigung**, keine Festlegung. Die Kontonummern der
Unterkonten muss der Steuerberater vergeben — im Mandanten frei sind nur, was er weiß.

## Kontenrahmen: SKR03

Belegt aus vier unabhängigen Quellen im bestehenden Autohandel-Betrieb desselben Inhabers
(Steuerberater-Unterlage, Kassencode, Datenbankvorgabe, ReifenPro-Export). Im Rechnungswesen
sind bereits hinterlegt: Debitoren 1400, Erlöse 19 % 8400, Erlöse 7 % 8300.

## Zuerst zu klären: ein Widerspruch bei 8300 und 8200

Im Autohandel ist **8300 als „Ersatzteile/Zubehör 19 %"** und zusätzlich als Pfandkonto
belegt, **8200 als „Werkstattleistung 19 %"**. Im SKR03-Standard ist 8300 dagegen das
**7-%-Automatikkonto** und 8200 ein Erlöskonto ohne Steuerautomatik. In ReifenPro ist 8300
heute der 7-%-Erlös.

Da es zwei getrennte Firmen mit getrennter Buchführung sind, ist das für ReifenPro nicht
akut — aber der Kontenplan des Autohandels darf nicht übernommen werden, und die Belegung
dort sollte gegengeprüft werden. Eine 19-%-Buchung auf einem 7-%-Automatikkonto wird mit
7 % versteuert.

## Erlöskonten — Vorschlag: vier bis fünf, alle 19 %

| Zweck | Konto | USt |
|---|---|---|
| Werkstattleistung (Räderwechsel, Montage, Auswuchten, Fahrwerk, Bremsen) | 8400 | 19 % |
| Reifen- und Räderverkauf | Unterkonto, z. B. 8401 | 19 % |
| Einlagerung / Saisonlager | Unterkonto, z. B. 8402 | 19 % |
| Zubehör und Kleinteile (Ventile, Gewichte, RDKS) | Unterkonto, z. B. 8403 | 19 % |
| Altreifenentsorgung | Unterkonto, z. B. 8404 | 19 % |
| Erlöse 7 % (Auffangkonto, praktisch ungenutzt) | 8300 | 7 % |

Warum trennen: Beim Reifenverkauf steht dem Erlös ein hoher Wareneinsatz gegenüber, bei der
Montage fast keiner. In einem Sammelkonto ist die Rohertragsquote nicht mehr lesbar. Die
Einlagerung ist wiederkehrender Umsatz und die interessanteste Kennzahl des Betriebs.
Umsatzsteuerlich bringt die Trennung nichts — es ist reine Auswertungsqualität.

Alle Unterkonten müssen **Automatikkonten mit 19 %** sein, sonst braucht der DATEV-Export
je Konto einen BU-Schlüssel.

## Die sieben Konten, mit denen die Kasse startet

Vom Inhaber am 31.08.2026 festgelegt. Alle sieben sind SKR03-Standardkonten, keines ist
erfunden — bitte trotzdem bestätigen oder korrigieren.

| Konto | Zweck | Satz |
|---|---|---|
| 1000 | Kasse (Bargeld) | — |
| 1360 | Geldtransit: EC-Zahlung bis zur Gutschrift, Bargeld zur Bank | — |
| 1400 | Forderungen — Zahlung auf eine offene Rechnung | 0 % |
| 8400 | Erlöse 19 % — alle Leistungen und Warenverkäufe | 19 % |
| 1800 | Privatentnahme aus der Kasse | — |
| 1890 | Privateinlage in die Kasse | — |
| 4900 | Sonstige betriebliche Aufwendungen — Sammelkonto für bar bezahlte Kleinigkeiten | **ohne Steuerautomatik** |

Bewusst NICHT dabei: Unterkonten je Leistungsart (die Betragsart steht im Buchungstext),
Anzahlungen, Differenzbesteuerung, Pfand, Trinkgeld, Gutscheine, ein eigenes Stornokonto.
Nichts davon kommt im Betrieb vor. Ein Konto lässt sich in einer Minute nachtragen; eine
Fehlbuchung auf einem überflüssigen Konto ist TSE-signiert und nur per Storno zu korrigieren.

## Geldkonten

| Zweck | Konto |
|---|---|
| Kasse (Bargeld) | 1000 |
| Bank | 1200 |
| Geldtransit, auch EC-Zahlung bis zur Gutschrift | 1360 |
| Forderungen aus Lieferungen und Leistungen | 1400 |

EC-Zahlung: Verkauf gegen 1360, Gutschrift der Tagessumme 1200 an 1360, Gebühren als
Aufwand. Am Monatsende läuft 1360 gegen null. Ein EC-Umsatz darf nie ins Kassenbuch —
das ist bei einer Kassennachschau der erste Prüfpunkt.

## Stripe

Grundregel: eigenes Verrechnungskonto, das den Stripe-Kontostand abbildet. Bruttoprinzip.

| Vorgang | Buchung |
|---|---|
| Kunde zahlt 119,00 € | Stripe-Verrechnungskonto an Erlöse, **volle** 119,00 € |
| Stripe-Gebühr 2,50 € | Gebührenkonto an Stripe-Verrechnungskonto |
| Auszahlung 116,50 € an die Bank | Bank an Stripe-Verrechnungskonto |

Sammelauszahlungen sind damit unproblematisch: Die Auszahlung ist ein reiner
Geldkontentausch, die Zuordnung passiert innerhalb des Stripe-Kontos. Der Steuerberater
braucht monatlich den Stripe-Report (Bruttoumsatz, Gebühren, Auszahlungen, Rückerstattungen).

**Zu klären:** Vertragspartner ist in der Regel Stripe Payments Europe in Irland. Dann ist
die Gebühr eine sonstige Leistung aus dem EU-Ausland, für die der Leistungsempfänger die
Umsatzsteuer schuldet (§ 13b UStG). Das braucht eine eigene USt-IdNr. und ein Aufwandskonto
mit § 13b-Automatik statt des normalen Gebührenkontos.

## Betragsarten für die Kassenschnittstelle

| Betragsart | Konto | USt | Erlös? |
|---|---|---|---|
| montage | 8400 | 19 % | ja |
| reifenkauf | Unterkonto | 19 % | ja |
| einlagerung | Unterkonto | 19 % | ja |
| zubehoer | Unterkonto | 19 % | ja |
| entsorgung | Unterkonto | 19 % | ja |
| **rechnungsausgleich** | **1400** | **keine** | **nein — kein Erlös** |
| rabatt, storno, retoure | wie Original, negativ | wie Original | negativer Erlös |
| privatentnahme / privateinlage | 1800 / 1890 | keine | nein |
| geldtransit | 1360 | keine | nein |

Der kritische Fall ist der Zahlungseingang auf eine bereits gestellte Rechnung: **Kasse an
Forderungen**, kein Erlöskonto, kein Steuerschlüssel. Umsatz und Steuer sind mit der
Rechnungsstellung entstanden; ein zweites Mal gebucht stünde derselbe Umsatz doppelt in der
Voranmeldung.

## Steuerliche Besonderheiten

**Altreifenentsorgung** ist steuerpflichtiger Umsatz mit 19 %, kein durchlaufender Posten.
Offen: ob die Abgabe an einen Verwerter gegen Gutschrift unter § 13b UStG (Abfälle und
Schrott) fällt.

**Anzahlungen gibt es nicht** (Stand 31.08.2026, Entscheidung des Inhabers). Der Punkt wäre
nur relevant, wenn später eine Online-Vorkasse bei der Terminbuchung dazukommt: Dann
entsteht die Steuer bereits mit dem Geldeingang, die Anzahlungsrechnung muss sie offen
ausweisen und die Schlussrechnung sie abziehen. Wird das vergessen, wird die Steuer doppelt
geschuldet.

**Gutscheine:** Was ReifenPro heute führt, sind Prozent-Rabattcodes — der Kunde zahlt nichts
dafür. Das ist eine Entgeltminderung, kein Gutschein im Sinne des Umsatzsteuerrechts.
Sobald aber ein bezahlter Wertgutschein verkauft wird, gilt: Da alle Leistungen im Inland mit
19 % erbracht werden, stehen Steuersatz und Leistungsort fest — es wäre sehr wahrscheinlich
ein **Einzweckgutschein**, also **sofort bei Verkauf zu versteuern**. Das wird häufig falsch
gemacht.

**Kleinbetragsrechnung** bis 250 € brutto ohne Empfängerangabe (§ 33 UStDV) — das prüft das
System bereits. Davon zu unterscheiden ist die Belegausgabepflicht ab dem ersten Bargeschäft,
unabhängig vom Betrag.

**Einlagerung über den Jahreswechsel:** Bei Bilanzierung stellt sich die Frage der passiven
Rechnungsabgrenzung, bei Einnahmen-Überschuss-Rechnung nicht.

## Fragen an den Steuerberater

1. SKR03 bestätigen, oder gibt es einen Grund für SKR04?
2. Der Widerspruch bei 8300 und 8200 im Autohandel: gewollt oder Fehler? Welche Konten
   gelten für ReifenPro?
3. Bitte die freien Unterkonten für Werkstattleistung, Reifenverkauf, Einlagerung, Zubehör
   und Entsorgung vergeben — oder ist ein einziges Erlöskonto lieber?
4. Sind alle Erlöskonten Automatikkonten, sodass der DATEV-Export ohne BU-Schlüssel auskommt?
5. **Stripe, Teil a — bitte zuerst beantworten, das hält die Kasse auf:** Welches freie
   Geldkonto nehmen wir als **Verrechnungskonto**, auf dem die Kundenzahlung landet? Mehr
   braucht die Kasse nicht.
6. **Stripe, Teil b — betrifft nur die Buchhaltung, nicht die Kasse:** Auf welches Konto
   gehören die **Stripe-Gebühren**? Vertragspartner ist in der Regel Stripe Payments Europe
   in Irland; dann greift § 13b UStG und es braucht ein Aufwandskonto mit Reverse-Charge-
   Automatik statt eines normalen Gebührenkontos — und eine eigene USt-IdNr. Die Gebühr wird
   erst bei der Auszahlung gebucht, nicht beim Verkauf.
7. Einnahmen-Überschuss-Rechnung oder Bilanz? Davon hängen Debitorenkonten und die
   Abgrenzung der Einlagerung ab.
8. Ist-Versteuerung nach § 20 UStG beantragen? Bei Neugründung möglich und liquiditätsschonend.
9. Bezahlte Wertgutscheine: immer Einzweckgutscheine? Welches Konto, welche Steuerautomatik?
10. Altreifen an den Verwerter gegen Gutschrift: § 13b UStG?
11. Reifenbezug aus dem EU-Ausland: welches Konto, und was ist vor der ersten Bestellung zu
    erledigen (USt-IdNr., Zusammenfassende Meldung)?
12. Kautionen für Leihräder: eigenes Verbindlichkeitskonto?
13. Dürfen zwei getrennte Firmen an derselben Cloud-TSE hängen, oder braucht jede ihre eigene?
14. DATEV-Berater- und Mandantennummer sowie Sachkontenlänge für ReifenPro. Bitte den ersten
    Buchungsstapel testweise importieren, bevor er produktiv genutzt wird.

## Zwei Warnungen

Der Kontenplan des Autohandels darf **nicht** übernommen werden — die Belegung von 8300
und 8200 ist der Beweis.

Die Liste der Betragsarten muss **abschließend** feststehen, bevor die Kassenanbindung
gebaut wird: Ein unbekannter Wert wird von der Kasse heute stillschweigend als Anzahlung
verbucht. Eine solche Fehlbuchung ist TSE-signiert und lässt sich nur durch eine
Stornobuchung korrigieren, nicht löschen.
