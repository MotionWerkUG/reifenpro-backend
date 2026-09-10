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

---

# Wartet auf Davids Wort

Je Punkt: was er entscheiden muss, was es bewirkt, was schiefgehen kann. Wer einträgt, nennt
seinen Bereich. Beantwortet David einen Punkt, wandert er mit seinem Wortlaut nach oben zum
Datum — und wird hier gestrichen.

## Homepage/CMS — drei nginx-Punkte

Gemeinsame Auflagen für alle drei, falls er zustimmt: Sicherungskopie der Konfiguration,
`nginx -t` vor jedem Reload, danach gemessen, dass die CMS-Vorschau noch lädt.

**1. Sicherheitskopfzeilen setzen**
- FRAGE: Dürfen auf beiden Domains HSTS, X-Content-Type-Options, Referrer-Policy und ein
  Rahmenschutz gesetzt werden?
- WIRKUNG: Der Browser erzwingt https, rät Dateitypen nicht mehr selbst, gibt beim Wechsel auf
  fremde Seiten nur noch die Herkunft statt der vollen Adresse weiter, und die Seite lässt sich
  nicht mehr in fremde Rahmen einbetten (Schutz gegen Klickfallen).
- RISIKO: Der Rahmenschutz MUSS auf www als
  `Content-Security-Policy: frame-ancestors 'self' https://admin.schroeder-scholz.de` gesetzt
  werden, NICHT als `X-Frame-Options`. Das CMS zeigt die Homepage in einem Rahmen (cms.html
  Zeile 377, Quelle `https://www.schroeder-scholz.de/?editor=1`), und es läuft auf einer anderen
  Domain — `SAMEORIGIN` oder `DENY` machen Davids Vorschau schwarz, und er merkt es erst beim
  nächsten Bearbeiten. `DENY` gehört nur auf admin. HSTS wirkt lange nach: Ein falsch gesetzter
  Wert sperrt Browser für Monate auf https fest, auch wenn wir ihn zurücknehmen.
  Referrer-Policy bitte `strict-origin-when-cross-origin`, nicht `no-referrer` — sonst sieht
  David in der Statistik nicht mehr, ob Besucher von Google kommen.

**2. Adminbereich aus den Suchmaschinen halten**
- FRAGE: Darf admin.schroeder-scholz.de per `X-Robots-Tag: noindex` und robots.txt aus den
  Suchmaschinen genommen werden?
- WIRKUNG: Die Verwaltungsoberfläche taucht nicht mehr in Google auf.
- RISIKO: Gering. Es ist kein Zugangsschutz — wer die Adresse kennt, erreicht sie weiterhin;
  der Schutz bleibt die Anmeldung. Wirkt erst, wenn Google erneut vorbeischaut.

**3. Unbekannte Adressen mit 404 beantworten (unter /portal/)**
- FRAGE: Darf `try_files … =404` auch unter /portal/ gelten, so wie es für die Startseite schon
  gilt?
- WIRKUNG: Eine falsch getippte Adresse liefert eine Fehlermeldung statt der Startseite mit
  Status „alles in Ordnung". Google hält dann nicht länger beliebig viele Adressen für gültige
  Seiten, und in der Statistik ist sichtbar, wonach jemand gesucht hat.
- RISIKO: Bricht alles, was auf den Rückfall angewiesen ist. Für die erzeugte Website habe ich
  nachgemessen, dass es nichts gibt (/, /termin/, /preise/, /sitemap.xml, /robots.txt,
  /impressum/, /uploads/ alle 200; /termin und /preise 301 auf die Fassung mit Schrägstrich).
  Für /portal/ hat die Portal-Session dasselbe belegt. Rücknahme ist eine Zeile.

**4. Sicherungsdateien nicht mehr ausliefern** (gehört sachlich dazu, ebenfalls nginx)
- FRAGE: Dürfen Dateien mit `.bak`, `.old`, `.orig` grundsätzlich mit 404 beantwortet werden?
- WIRKUNG: Ein Netz gegen die Wiederholung dessen, was am 09.09. gefunden wurde — sechs alte
  Fassungen der Buchungsseite und acht alte Rechtstexte waren öffentlich abrufbar, darunter eine
  Datenschutzfassung mit der falschen Aufsichtsbehörde und Buchungsformulare mit nur einem
  Einwilligungshäkchen statt dreier.
- RISIKO: Praktisch keins. Beide Webroots sind heute sauber; die Regel greift erst, wenn wieder
  jemand neben die Live-Datei sichert.
