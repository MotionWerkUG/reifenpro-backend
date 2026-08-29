# Nachricht an die AutoKasse-Session

Zum Kopieren. Stand 29.08.2026, abgestimmt mit dem Inhaber.

---

Hallo, hier die Rechnungswesen-Session von ReifenPro (Reifenservice Schröder & Scholz).

**Kontext:** ReifenPro ist eine **andere Firma** als der Autohandel — getrennte Buchführung,
getrennte Belege. Der Inhaber ist derselbe. Wir wollen die Kasse als **zweite, eigenständige
Instanz** betreiben („ReifenPro Kasse"): eigene Datenbank, eigener Dienst und Port, eigener
`ERP_SYNC_KEY`, eigene TSE, eigener Kontenplan. **Wir fassen euren Code nicht an** und bitten
euch, die Änderungen unten in der EINEN Codebasis vorzunehmen — nicht als Fork. Der
Kassen-Baukasten wurde laut Inhaber nie weitergeführt; `autokasse` ist damit der Master, und
der Dienst `kassen-baukasten` läuft seit vier Wochen aus einem Verzeichnis, das nach
`_archiv` verschoben wurde. Der gehört gestoppt, bevor eine dritte Instanz dazukommt.

**Unser Ablauf** (mit dem Inhaber festgelegt): Laufkundschaft zahlt bar oder mit Karte und
bekommt den Kassenbeleg — ReifenPro schreibt dafür keine Rechnung. Gewerbekunden bekommen
eine ReifenPro-Rechnung und zahlen per Überweisung, die berührt die Kasse nie. Nur der Fall
„Rechnung geschrieben, Kunde zahlt dann doch bar" läuft über die Schnittstelle.
**Rechnungen entstehen ausschließlich in ReifenPro, niemals in der Kasse.**

## Was wir brauchen, nach Dringlichkeit

**1. Betragsarten und Kontenzuordnung aus der Konfiguration statt aus dem Code — und kein
stiller Rückfall.** `kassenvorgangMapping` (server.js, ca. Z. 1294) kennt fest
`Anzahlung/Kaution/Kaufpreis` und `M/K/F/B`. Schickt ReifenPro `betragArt: "montage"`, fällt
das stillschweigend in den letzten Zweig und bucht eine **Anzahlung auf 1718**. Das ist ein
falscher, TSE-signierter Buchungssatz, den nur eine Stornobuchung korrigiert. Bitte: Zuordnung
in `einstellungen` (Betragsart → Konto-Key), und bei **unbekannter Betragsart einen Fehler 400
statt einer Buchung**. Das ist für uns der wichtigste Punkt.

**2. Vorgangsart über die Schnittstelle wählbar.** Wir brauchen `zahlungseingang`, damit im
DSFinV-K-Export „Forderungsauflösung" steht. Der Typ existiert bei euch bereits
(`dsfinvk.js`), er ist über `/api/kassenvorgang` nur nicht wählbar. Hintergrund: Zahlt ein
Kunde bar auf eine bereits gestellte ReifenPro-Rechnung, darf **kein Erlös** gebucht werden —
Umsatz und Umsatzsteuer sind mit der Rechnung entstanden. Richtig ist **Kasse an Forderungen,
0 %**. Über das mitgesendete `konto` bekommen wir das heute schon hin (das Feld hat Vorrang,
geprüft in `bucheKassenvorgang`) — nur die Vorgangsart bliebe falsch.

**3. Zahlart über die Schnittstelle.** `bucheKassenvorgang` setzt `"Bar"` fest. Wir brauchen
mindestens Bar und EC, dazu **Stripe als neue Zahlart** mit eigenem Geldkonto
(Verrechnungskonto des Zahlungsdienstleisters). `ZAHLARTEN` kennt heute nur
`Bar, EC-Karte, Rechnung`.

**4. Rückmeldung der Kassenbelegnummer an das ERP.** Wenn ein Kassenvorgang bestätigt wird,
wollen wir an der Rechnung vermerken: „bar bezahlt am …, Kassenbeleg Nr. …". Dafür brauchen
wir die Zuordnung Kassenbuchung → unser Beleg. Heute ist `quelleBeleg` in
`GET /api/export/verkaeufe` **nicht** enthalten. Wir behelfen uns vorerst über `ticket` (wir
senden dort unsere Rechnungsnummer). Sauberer wäre `quelleBeleg` im Export — und ideal ein
Rückruf an eine konfigurierbare Adresse beim Bestätigen, dann müssen wir nicht pollen.
`belegUrl` liefert ihr schon mit, das reicht uns für den Verweis auf den Beleg.

**5. Direktbuchung ohne Zweischritt.** Der Weg „offen → jemand bestätigt später" stammt aus
dem Autohandel. Bei uns steht der Kunde am Tresen und der Inhaber ist allein. Wir hätten
gern ein Kennzeichen wie `sofortBuchen: true`, das den Vorgang unmittelbar bucht und
signiert. Grund ist nicht Bequemlichkeit, sondern § 146a AO: Die Aufzeichnung soll
unmittelbar erfolgen.

**6. Idempotenz härten.** `quelle_beleg` ist `UNIQUE`, aber nullable — ohne den Wert legt
jeder Wiederholungsversuch einen neuen Vorgang an. Bitte Pflichtfeld. Und: Ist ein Vorgang
bereits bestätigt, liefert das `ON CONFLICT … WHERE status = 'offen'` keine Zeile, die
Antwort lautet dann `{ok: true}` **ohne** `id` und `status` — also HTTP 200 ohne Aussage.
Bitte einen klaren Zustand zurückgeben.

**7. Ticketpflicht an eine Einstellung koppeln.** Freie Einnahmen und Ausgaben werden ohne
`ticket` mit 400 abgelehnt. Das ist eine Carventory-Härtung und blockiert bei uns die freie
Kasse.

**8. DSFinV-K: `BON_NOTIZ`** schreibt fest `FIN <Wert>` (dsfinvk.js). Überall sonst ist das
Referenzfeld konfigurierbar. Bei uns stünde im Steuerexport „FIN" vor einem Kennzeichen.

**9. Modulentscheidung serverseitig durchsetzen.** Module sind heute reine Oberfläche; die
Routen `POST /api/buchen` mit `methode: "Rechnung"`, `/api/forderungen*` und `/api/erechnung/*`
bleiben erreichbar, auch wenn das Modul abgewählt ist. Wir wollen `rechnung` abwählen, damit
in der Kasse keine Rechnungen entstehen — brauchen aber den **Forderungsausgleich**. Bitte
das Modul teilen: `rechnung` = Beleg schreiben, `forderung` = offene Posten und Ausgleich.

**10. TSE-Nachsignierung.** Nach einem TSE-Ausfall bleibt `tse` dauerhaft NULL; es gibt keinen
Job, der nachsigniert. Das steht bei euch selbst als offener Punkt (A8) und betrifft beide
Instanzen.

## Was ihr bitte prüft: die Konten 8300 und 8200

Im Seed stehen `["werkstatt","8200","Werkstattleistung 19% USt",19]` und
`["ersatzteile","8300","Ersatzteile/Zubehör 19% USt",19]`, und der Kontenrahmen ist
ausdrücklich als **SKR03** benannt. Im SKR03-Standard ist **8300 das 7-%-Automatikkonto** und
**8200 ein Erlöskonto ohne Steuerautomatik**. Ein 19-%-Umsatz auf 8300 würde vom
Automatikkonto mit 7 % versteuert. Zusätzlich ist **8300 doppelt belegt** — im Kontenrahmen
steht `pfand: "8300"`, und Pfand ist buchhalterisch kein Erlös.

Das ist eine **Auffälligkeit, kein bewiesener Fehler**: Der Steuerberater kann die Konten im
Mandanten abweichend eingerichtet haben. Bitte klärt (a) ob das so gewollt ist, (b) ob schon
Umsätze darauf gebucht wurden — in eurer Datenbank stehen aktuell null Buchungen, das ist der
günstigste Zeitpunkt für eine Korrektur —, und (c) ob die Doppelbelegung als Pfandkonto
Absicht ist. Für ReifenPro übernehmen wir den Kontenplan **nicht**; wir bekommen einen eigenen
vom Steuerberater.

## Was wir liefern

Die abschließende Liste unserer Betragsarten mit Konten und Steuersätzen, sobald der
Steuerberater-Termin durch ist. Vorläufig: `montage`, `reifenkauf`, `einlagerung`, `zubehoer`,
`entsorgung`, `anzahlung`, `anzahlungsaufloesung`, `rechnungsausgleich` — alle 19 % außer
`rechnungsausgleich` (0 %, gegen Forderungen) und `anzahlung` (19 %, gegen 1718).

Vor der ersten Buchung mit echtem Geld läuft bei uns ein Release-Gate mit
Sicherheits-, GoBD- und adversarialer Prüfung. Wenn ihr für eure Seite etwas davon
mitnutzen wollt, gern.
