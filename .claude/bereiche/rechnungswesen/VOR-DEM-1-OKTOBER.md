# Was vor dem 1. Oktober 2026 erledigt sein muss

Stand 07.09.2026. Geprüft am laufenden System gegen eine Kopie der echten Produktionsdaten
(isolierte Instanz, danach entfernt) — nicht aus dem Code abgeleitet, sondern gemessen.

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

## Wichtig, aber nicht blockierend

### 3. Aktives Testkonto mit Mitarbeiterrechten

`werkstatt-test@intern.local` ist in der Produktion **aktiv** und hat die Rolle Mitarbeiter.
Zwei weitere Testkonten (`qa-admin@test.local`, `ui-test@intern.local`) sind inaktiv und damit
unkritisch.

In der Entwicklungsphase ist das gewollt. Ab dem ersten Geschäftstag ist es ein
Zugang zu echten Kunden- und Rechnungsdaten, der keiner Person zugeordnet ist — im
Änderungsprotokoll steht dann ein Benutzer, den niemand verantwortet. Vor dem 1. Oktober
entweder deaktivieren oder einer realen Person zuordnen. Gehört nicht mir allein: Andere
Bereiche nutzen die Testkonten für Oberflächentests.

### 4. Kassenanbindung ist nicht konfiguriert

`KASSE_URL` und `KASSE_ERP_KEY` fehlen in der produktiven `.env`. Die Kassieren-Schaltflächen
bleiben deshalb ausgeblendet — so gebaut, damit keine halbe Anbindung entsteht. Ohne diese
Werte lässt sich am Tresen weder bar noch mit Karte kassieren.

### 5. Offene Punkte aus der Rechtsprüfung

- Bestätigung der sieben Konten durch den Steuerberater
- Eigene fiskaly-Live-TSE (bisher nur Test-TSE)
- ELSTER-Meldung der Kasse nach § 146a Abs. 4 AO
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
