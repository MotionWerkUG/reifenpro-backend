# Befund für die Kassen-Session: Konten 8300 und 8200 im SKR03

Gefunden am 29.08.2026 bei der Recherche zum Kontenplan der geplanten ReifenPro-Kasse.
Betrifft die bestehende AutoKasse, nicht ReifenPro. Bitte prüfen, nicht blind ändern —
die endgültige Beurteilung gehört dem Steuerberater.

## Was im Code steht

`backend/db/seed.js`:

```
["werkstatt",    "8200", "Werkstattleistung 19% USt",   19, "einnahme", false]
["ersatzteile",  "8300", "Ersatzteile/Zubehör 19% USt", 19, "einnahme", false]
```

`backend/server.js`, Vorgabe des Kontenrahmens:

```
kontenrahmen: { name: "SKR03", … pfand: "8300", … }
```

Der Kontenrahmen ist an derselben Stelle ausdrücklich als **SKR03** benannt, ebenso in
`STEUERBERATER-BU-SCHLUESSEL.md` („Kontenrahmen: SKR03").

## Warum das auffällt

Im SKR03-Standard ist

- **8300** das Erlöskonto mit **7 % Steuerautomatik**,
- **8200** ein Erlöskonto **ohne** Steuerautomatik.

Beide sind im Seed mit **19 %** hinterlegt. Wenn die Konten im DATEV-Mandanten die
Standardbelegung haben, würde ein 19-%-Umsatz auf 8300 vom Automatikkonto mit **7 %**
versteuert — die Umsatzsteuer wäre zu niedrig. Auf 8200 entstünde ohne Automatik gar keine
Steuer, solange kein BU-Schlüssel mitgegeben wird; der Export der Kasse setzt zwar einen
(9 für 19 %), aber dann widersprechen sich Konto und Schlüssel.

Zusätzlich ist **8300 doppelt belegt**: einmal als Erlöskonto „Ersatzteile/Zubehör",
einmal als Pfandkonto im Kontenrahmen. Pfand ist buchhalterisch etwas anderes als Erlös.

## Was das für ReifenPro bedeutet

In ReifenPro ist **8300 als Erlöskonto für 7 %** hinterlegt — also nach SKR03-Standard.
Die beiden Systeme meinen mit derselben Kontonummer Verschiedenes. Solange es zwei
getrennte Firmen mit getrennter Buchführung sind, kollidiert nichts. Aber:

**Der Kontenplan der AutoKasse darf nicht nach ReifenPro kopiert werden.**

## Was zu klären ist

1. Sind 8200 und 8300 im DATEV-Mandanten des Autohandels **abweichend eingerichtet**
   (individuelle Konten statt Standardbelegung)? Dann ist alles in Ordnung, und es fehlt nur
   der Vermerk im Kontenplan-Dokument.
2. Falls nicht: Wurden auf diesen Konten bereits Umsätze gebucht? In der Kassendatenbank
   stehen aktuell **null Buchungen**, es wäre also noch nichts passiert — das ist der
   günstigste Zeitpunkt für eine Korrektur.
3. Ist die Doppelbelegung von 8300 als Pfandkonto gewollt?
4. Für ReifenPro: eigener Kontenplan, keine Übernahme. Vorschlag liegt in
   `STEUERBERATER-VORLAGE.md`.

## Hinweis zur Einordnung

Dass die Konten im Seed stehen, heißt nicht automatisch, dass falsch gebucht wird — der
Steuerberater kann die Konten im Mandanten anders eingerichtet haben. Genau das ist die
Frage. Der Befund ist eine Auffälligkeit, kein bewiesener Fehler.
