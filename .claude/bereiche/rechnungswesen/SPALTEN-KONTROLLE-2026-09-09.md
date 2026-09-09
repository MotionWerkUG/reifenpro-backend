# Kontrolle: Legen wir unnötige Spalten an?

Auf Nachfrage des Inhabers, abgestimmt zwischen Rechnungswesen, Admin, Portal und Homepage.
Stand 09.09.2026. Alle Zahlen gemessen, nicht geschätzt.

## Die kurze Antwort

**Speicherplatz ist nicht das Problem. Ein echter Fund ist da — aber ein anderer, als die
Frage vermuten ließ.**

Die gesamte Datenbank ist **11 MB** groß. Leere Spalten kosten in PostgreSQL praktisch nichts;
selbst bei 24.000 Rechnungen über acht Jahre bliebe die Rechnungstabelle im zweistelligen
Megabyte-Bereich. Wer mit „das kostet ja kaum Platz" beruhigt, beantwortet die Frage nicht.

Das Problem ist **Verständlichkeit**: Bei 95 Spalten in einer Tabelle findet der Nächste zwei
Felder, die dasselbe zu bedeuten scheinen, und muss raten, welches gilt. Genau das ist an drei
Stellen eingetreten.

## Gemessen

| Tabelle | Spalten |
|---|---|
| einstellungen | 95 |
| kunden | 62 |
| termine | 51 |
| rechnungen | 37 |
| einlagerungen | 26 |
| *gesamt* | *44 Tabellen, 580 Spalten, 11 MB* |

## Die Funde

### 1. Zehn Spalten führen eine zweite Wahrheit über die Öffnungszeiten

In `einstellungen` liegen `mo_fr_von`, `mo_fr_bis`, `sa_von`, `sa_bis`, `sa_offen`, `so_von`,
`so_bis`, `so_offen`, `mittagspause_von`, `mittagspause_bis`. Daneben gibt es die Tabelle
`oeffnungszeiten` mit sieben Zeilen und zwei Zeitspannen je Tag. Bei jedem Speichern werden die
zehn Spalten aus dem Wochenraster mitgeschrieben.

**Was heute drinsteht — und hier musste ich zwei Kollegenbefunde richtigstellen:**

    Raster (Quelle):  Mo-Fr 08:00-12:00 und 13:00-18:00, Sa 08:00-13:00, So zu
    Spiegel:          Mo-Fr 08:00-18:00, Pause 12:00-13:00

Es wurde gemeldet, die Mittagspause fehle im Spiegel und die Quellen widersprächen sich bereits
heute. **Das stimmt nicht.** Die Pause steht in zwei eigenen Spalten; liest man alle zehn
zusammen, ergibt sich derselbe Stand wie im Raster. Heute ist nichts falsch.

**Der Fehler ist struktureller Natur und deshalb schlimmer:** Der Spiegel kann genau *einen*
Mo–Fr-Block und *eine* Pause für die ganze Woche halten. Sobald ein einzelner Wochentag anders
liegt — mittwochs länger, dienstags keine Pause —, kann er das nicht abbilden und behält still
den alten Einheitswert.

Sechs Dateien lesen die Spiegelspalten als Rückfall. Greift einer davon nach einer solchen
Änderung, zeigt die Website Zeiten, die es nicht gibt. Auf einer Seite, die Öffnungszeiten
nennt, ist das kein Schönheitsfehler: Ein Kunde steht vor verschlossener Tür.

**Der Ausbau berührt drei Bereiche** (Admin-Kalender, Portal-Antworten, Homepage-Rückfälle) und
ist eine produktive Migration. Niemand fängt einseitig an — er braucht eine Freigabe.

### 2. Eine tote Spalte mit widersprechender Vorgabe

`einstellungen.termine_pro_stunde` kommt in keiner Programmdatei mehr vor und steht nicht in
der Änderungserlaubnis — sie ließe sich gar nicht mehr setzen. Ihre Aufgabe hat
`max_parallele_termine` übernommen.

Ärgerlich ist der Rest: Sie trägt die Vorgabe **2**, während `max_parallele_termine` mit **1**
arbeitet. Zwei Einstellungen, die dasselbe zu bedeuten scheinen, eine davon wirkungslos und mit
einem anderen Wert. Genau das Bild, das die Nachfrage ausgelöst hat.

### 3. Ein irreführender Name

`kunden.portal_verifiziert` klingt nach E-Mail-Verifikation. Sie bedeutet aber
„Datenschutzerklärung unterschrieben vorgelegt". Daneben liegt `portal_email_bestaetigt`, das
die E-Mail-Verifikation tatsächlich ist. Umbenennen kostet nichts und behebt genau das
Ratespiel, um das es geht.

## Was jede Sitzung bei sich selbst gestrichen hat

| Bereich | Gestrichen |
|---|---|
| Rechnungswesen | `kasse_erstattung_am` — bevor sie je in der Produktion war |
| Portal | `baujahr` — die Erstzulassung hat die Aufgabe übernommen |
| Admin | `termine_pro_stunde` vorgeschlagen |
| Homepage | kein Fund in den eigenen Tabellen |

## Die Regel, auf die wir uns geeinigt haben

1. **Ist der Wert aus etwas ableitbar, das schon gespeichert ist?** Wenn ja, nicht speichern.
   Ein zweiter Speicherort ist ein zweiter Ort, an dem etwas falsch sein kann.
2. **Kann die Zielstruktur alles abbilden, was die Quelle kann?** Ein echtes Duplikat ist
   unangenehm, aber harmlos. Eine *Vereinfachung*, die als Duplikat auftritt, muss irgendwann
   falsch antworten — und niemand merkt es, weil sie wie eine Kopie aussieht.
3. **Muss ein Wert doch doppelt liegen** (etwa als eingefrorener Beleg), gehört in die
   Migrationsdatei, **welche Quelle führt**. Bei den Öffnungszeiten steht das nirgends —
   deshalb konnte niemand wissen, dass der Spiegel nur ein Rückfall ist.
4. **Ableitbarkeit kann vergehen.** Was heute nachrechenbar ist, ist es nach einem
   Bibliotheks- oder Layoutwechsel nicht mehr.
5. **Wiederkehrende Gruppen gehören in eine eigene Tabelle**, nicht in weitere Spalten.
6. **Die Begründung gehört in die Migrationsdatei.**

## Wo die Regel bewusst NICHT greift

Damit sie nicht zu scharf angewandt wird — drei geprüfte Gegenbeispiele:

- **Boolean plus Zeitstempel bei Einwilligungen.** Sieht redundant aus. Ist es nicht: Bei einem
  Widerruf wird das Ja zu Nein, während das Datum als Nachweis stehen bleiben muss.
- **`erstzulassung_genauigkeit`.** Aus `2019-01-01` lässt sich nicht ableiten, ob der 1. Januar
  erfasst wurde oder ob nur das Jahr bekannt war. Nicht ableitbar, also berechtigt.
- **Die Prüfsumme der Rechnungsbelege.** Seit die Erzeugung bitgenau wiederholbar ist, *ließe*
  sie sich nachrechnen — aber nur mit der heutigen Programmbibliothek. Über acht Jahre
  Aufbewahrung ist das keine Zusage. Die gespeicherte Prüfsumme ist ein Anker im Zeitpunkt der
  Ausstellung; eine Neuberechnung beantwortet eine andere Frage.

## Was die Kontrolle nebenbei über sich selbst gezeigt hat

Drei von vier Sitzungen haben beim Messen einen eigenen Fehler gemacht und ihn selbst
korrigiert: ein zu grober Suchlauf im Rechnungswesen, eine falsch gemeldete tote Spalte im
Portal, zwei ungenaue Behauptungen zu den Öffnungszeiten. Alle drei wurden gefunden, weil
jemand anderes nachgerechnet hat.

## Was entschieden werden muss

| Punkt | Wer |
|---|---|
| Ausbau der zehn Spiegelspalten (drei Bereiche, produktive Migration) | Inhaber |
| Löschen von `termine_pro_stunde` | Inhaber |
| Umbenennen von `portal_verifiziert` | Inhaber |
| Sind `portal_aktiv` und `portal_freigegeben` wirklich zwei Dinge? | Inhaber |
