# Was noch fehlt, bis die Kasse echtes Geld annehmen darf

Stand 2. September 2026. Eröffnung ist der 1. Oktober. Reihenfolge ist abgestimmt und steht
im Connector-Vertrag v1.5.

## Steht bereits

- Eigene Kassen-Instanz: eigener Dienst, eigene Datenbank `reifenpro_kasse`, eigener
  Schlüssel, eigene Adresse `https://reifenpro-kasse.161-97-187-239.sslip.io` — im Browser
  erreichbar, streng getrennt vom Autohandel.
- Sieben Favoritenkonten plus vollständiger SKR03 als durchsuchbarer Hintergrund.
- Betragsarten festgelegt; `rechnungsausgleich` bucht gegen Forderungen, nicht als Erlös.
- Beide Seiten der Schnittstelle gebaut und gemeinsam durchgespielt: Rechnung, bar kassiert
  (Kassenbeleg RSS-2026-10001), mit Karte kassiert (RSS-2026-10002), Storno — 14 Prüfungen
  ohne Abweichung.
- EC ist ab Tag eins vorgesehen, Stripe gesperrt.

## Der Inhaber

| Was | Warum es blockiert |
|---|---|
| **Steuernummer beim Finanzamt** | Ohne sie lässt sich keine Rechnung festschreiben (§ 14 UStG). Betrifft Rechnungen und Kasse gleichermaßen. |
| **Steuerberater bestätigt die sieben Konten** | Muss VOR der ersten Buchung stehen. Danach trägt jeder Beleg sein Konto fest und ist signiert — korrigierbar nur per Storno. Besonders zu klären: 1360 für EC-Zahlungen und 4900 ohne Steuerautomatik. |
| **Eigener fiskaly-Zugang** mit eigener TSS und eigenem Client | Die Kasse läuft heute auf einer Test-TSE. Belege daraus sind fiskalisch wertlos. Zwei Firmen sollten getrennte Zugänge haben. |
| **Meldung über ELSTER** nach § 146a Abs. 4 AO | Binnen eines Monats nach Inbetriebnahme. Braucht die gegründete Firma und die Steuernummer. |
| **Benutzerkonten in der Kasse** | Wer kassiert, muss sich anmelden — der Kassierer steht auf jedem Beleg. |
| **Anfangsbestand einbuchen** | Wechselgeld in der Schublade ist eine Privateinlage. Ohne diese Buchung stimmt der Kassensturz vom ersten Tag an nicht. |

Offen und noch nicht besprochen: **Bondrucker und Kassenlade.** Die Belegausgabepflicht lässt
sich digital erfüllen (die Kasse erzeugt einen Beleg über eine signierte Adresse mit QR-Code),
ein Papierbon am Tresen ist aber der Normalfall. Die Kasse unterstützt Drucker über Netzwerk.
Entscheidung des Inhabers, mit Vorlaufzeit für die Beschaffung.

## Die Kassen-Session

- Live-TSE eintragen, sobald der fiskaly-Zugang da ist.
- Testbelege bereinigen (`golive.sql`) — unmittelbar davor, nicht früher, sonst sammeln sich
  bis Oktober wieder Testbelege an. **Ab der ersten Echtbuchung ist das Skript tabu.**
- Verfahrensdokumentation der Kasse.

## Das Rechnungswesen

- **Die Kassenanbindung ist noch nicht ausgeliefert.** Sie liegt fertig und getestet auf dem
  Branch `rechnungen/datum-serverseitig` und wurde bewusst nicht am Tag des Livegangs
  eingespielt. Muss vor der ersten Kassenzahlung nach `main` und deployt werden.
- Produktion mit der Kasse verdrahten — erst am Tag der Live-TSE, keinen Tag früher.
- Gemeinsamer Durchlauf mit echter Signatur, danach die beiden Konsistenzprüfungen.
- Dem Datenbankbenutzer das Recht entziehen, die Rechnungstabellen zu leeren.
- Gemeinsame Verfahrensdokumentation, die beide Systeme und ihre Schnittstelle beschreibt.

## Reihenfolge

Gründung und Steuernummer → Konten bestätigt → fiskaly live → Anbindung ausgeliefert und
verdrahtet → Testbelege bereinigt → gemeinsamer Durchlauf → erste Echtbuchung →
ELSTER-Meldung binnen eines Monats.
