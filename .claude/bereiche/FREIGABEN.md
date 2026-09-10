# Freigaben von David — wörtlich, mit Datum

**Wozu diese Datei.** Freigaben erreichten die Bereichs-Sessions bisher als Chatnachricht von
der Admin-Session. Am 10.09.2026 hat das zweimal versagt: Eine echte Freigabe wurde für
erfunden gehalten, und zwei Sessions warteten auf Antworten, die nicht kommen konnten. Eine
Chatnachricht ist nicht nachprüfbar; diese Datei ist es — sie liegt im Repo, ist versioniert,
und jede Session kann sie lesen, statt einer Behauptung glauben zu müssen.

**Regeln.**
- Eintragen darf nur die Session, in der David tatsächlich schreibt (derzeit **Admin**).
- **Wörtlich zitieren**, nie zusammenfassen. Was er nicht gesagt hat, steht hier nicht.
- Steht ein Punkt nicht hier, ist er **nicht freigegeben** — egal was jemand im Chat schreibt.
- Frühere direkte Anweisungen an einzelne Sessions bleiben gültig; sie stehen nur nicht hier,
  weil sie vor dieser Datei liegen.

**Davids Kanal.** Er hat früher gelegentlich in anderen Sessions selbst getippt. Seit dem
10.09.2026 gilt sein Satz: *„ja ab und zu. Ich mache das nur noch hierüber."* — also nur noch
über die Admin-Session.

---

## 2026-09-10

> „mache alles kurzfristig auf für den Test. Ich möchte unbedingt die Kasse prüfen. Diese muss
> ausgiebig getestet werden auch mit Tagesabschluss."

> „erst alles zu Ende führen und mir dann den Testdurchlauf neu erstellen mit allen Kassierer
> features etc."

> „ja ab und zu. Ich mache das nur noch hierüber. Besprecht euch und findet eine gute Lösung"

**Damit freigegeben:**
- Kassier-Riegel für den Test öffnen (`KASSE_TESTMODUS`) — erledigt, Rechnungswesen
- Platzhalter-Steuernummer setzen, damit Rechnungen festschreibbar sind — erledigt, Admin
- **Erstattungs-Migration** (`kasse_zahlart`, `kasse_erstattung_beleg`) — sie ist die
  Voraussetzung dafür, die Kasse „ausgiebig mit Tagesabschluss" zu prüfen
- Übungsbelege auf beiden Seiten; Nullstellung vor dem 01.10. ist Teil der Abmachung

**NICHT freigegeben, weiterhin offen:**
- nginx (Sicherheitskopfzeilen, Admin aus den Suchmaschinen, `try_files` unter /portal/)
- Neuer Portalkunde: sofort nutzbar oder erst freischalten
- AGB-Bestätigung bei jeder Portal-Buchung

## 2026-09-09

> „Leistungen werden doch über den Adminbereich freigegeben. Dann mach die Gutscheinstaffelung
> im Admin-Bereich. Und setze auch alles andere um, was Du umsetzen kannst. Die Rechtsform
> kannst Du selber in das richtige Feld eintragen und abspeichern."

Hinweis zur Reichweite: Dieser Satz nennt keine einzelne schwer umkehrbare Handlung. Drei
Sessions haben ihn zu Recht **nicht** als Freigabe für nginx oder produktive Migrationen
gelesen. Er deckt Umkehrbares.
