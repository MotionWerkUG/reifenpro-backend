# Rechtsprüfung Gesamtsystem — 29.08.2026

Beauftragt vom Inhaber: gesetzliche Vorschriften, Datensicherung, Aufbewahrungsfristen,
GoBD über den gesamten Code. Koordiniert vom Bereich Rechnungswesen, durchgeführt mit drei
Prüfungen über den Gesamtcode plus Zuarbeit aus Admin, Portal und Homepage.

Jeder Punkt unten ist am Code oder an der laufenden Anlage belegt, nicht geschätzt.

## Muss vor dem Echtbetrieb erledigt sein

| # | Befund | Wo | Wer |
|---|---|---|---|
| 1 | `GET /api/kunden` liefert `SELECT k.*` — darin der Passwort-Hash des Kundenkontos und **gültige Reset-Token**. Wer die Antwort lesen kann, kann ein fremdes Kundenkonto übernehmen. | `kunden.js` | Admin |
| 2 | Auskunft nach Art. 15 DSGVO ist unvollständig: Termine, Fahrzeuge, Rechnungen, Protokolle, E-Mail- und Änderungsprotokoll fehlen. | `dsgvo.js` | Admin |
| 3 | „Vollständig gelöscht" stimmt nicht: im Änderungsprotokoll bleibt der komplette Kundendatensatz inklusive Passwort-Hash stehen, weil `RETURNING *` ungefiltert protokolliert wird. Widerspricht der eigenen Datenschutzerklärung. | `kunden.js`, `errorHandler.js` | Admin |
| 4 | Kontakt- und Gewerbeanfragen haben keinen Löschweg und keine Frist — Speicherbegrenzung nach Art. 5 DSGVO nicht umgesetzt. | `kontakt.js`, `gewerbe.js` | Portal/Admin |
| 5 | Unterschriebene Übergabeprotokolle liegen als PDF auf der Platte, ohne Schutz und ohne Prüfsumme. Aktuell null Stück — vor dem ersten echten Protokoll abzusichern. | `protokolle.js` | Admin |
| 6 | Das Änderungsprotokoll (`audit_log`) ist selbst nicht gegen Änderung gesperrt und nirgends einsehbar. | Datenbank | Admin |

## Datensicherung — echtes Verlustrisiko

| # | Befund | Stand |
|---|---|---|
| 7 | **Kein Monatsarchiv.** `full-backup.sh` ist genau dafür gebaut, steht aber in **keinem Crontab**. Lokale Sicherungen reichen 30 Tage zurück, die Kopie außer Haus rund ein halbes Jahr. Gegen acht Jahre Aufbewahrungspflicht. Ein Beleg, dessen Verlust nach zwei Monaten auffällt, ist endgültig weg. | offen, braucht Freigabe |
| 8 | **Belege liegen nicht außer Haus.** Die verschlüsselte Offsite-Sicherung umfasst nur Datenbanken. Rechnungs-PDFs, Protokolle und Gewerbedokumente gehen ausschließlich als Mailanhang hinaus. | offen, braucht Freigabe |
| 9 | Ein fehlgeschlagener Datenbank-Dump wurde als Erfolg gemeldet (leere Datei, Log sagt „Fertig"). | **behoben** |
| 10 | Das Datenbankpasswort stand in der Kommandozeile und wäre bei einem Fehler ins Logfile geschrieben worden. Im bestehenden Log ist es nie passiert. | **behoben** |
| 11 | `protokoll-dateien` fehlte in der Sicherung. Fix liegt im Branch, wirkt erst nach dem Merge nach `main`. | behoben, wartet auf Merge |
| 12 | Lokale Sicherung und Mailanhang sind unverschlüsselt und enthalten Passwort-Hashes und Unterschriftsbilder. | offen, braucht Freigabe |
| 13 | Kein automatischer Wiederherstellungstest. Andere Projekte auf dem Server haben einen. | offen |

Geprüft und in Ordnung: Der Cron läuft lückenlos (31 Tage ohne Lücke), die Sicherung ist
**wirklich wiederherstellbar** — in einer Wegwerf-Datenbank zurückgespielt, 33 Tabellen,
Zähler und Schutz-Trigger kommen korrekt mit, null Fehler. Anleitung dazu:
`.claude/bereiche/rechnungswesen/WIEDERHERSTELLUNG.md`.

## Aufbewahrungsfristen

Einheitlich auf **8 Jahre** (§ 147 Abs. 3 AO, § 14b Abs. 1 UStG in der Fassung des Vierten
Bürokratieentlastungsgesetzes), Geschäftskorrespondenz 6 Jahre. Korrigiert wurden:
Verfahrensdokumentation (Rechnungswesen), Datenschutzerklärung im Portal in beiden
Sprachfassungen (dort standen deutsch 10 und englisch 8 Jahre nebeneinander).
**Offen:** `dsgvo.js` nennt in derselben Antwort „10 Jahre" für Rechnungen und „8 Jahre"
für Buchungsbelege — dasselbe Objekt, zwei Fristen (Admin).

## Kasse und § 146a AO

Im heutigen Code wird nirgends bar kassiert, es gibt keine Kasse und keine Zahlungsart.
Die Kassensicherungsverordnung greift damit derzeit **nicht**. Das ändert sich, sobald das
geplante Kassensystem angebunden wird und bar kassiert wird: dann gelten TSE-Pflicht,
Belegausgabepflicht ab dem ersten Bargeschäft und die Meldepflicht über ELSTER. Die
Anbindung führt das Rechnungswesen, damit keine zweite Belegerzeugung neben dem
Nummernkreis entsteht. **Vom Steuerberater bestätigen lassen.**

## Im Rechnungswesen erledigt

§ 14-Pflichtangaben beim Festschreiben erzwungen (Aussteller, Inhaber, Empfänger, Steuersatz,
Leistungsbezeichnung), Nummernkreis lückenlos und atomar, Unveränderbarkeit per
Datenbank-Trigger, keine Rückdatierung, Storno als eigener Beleg mit Bezug zum Original,
Formel-Injektion in Journal und DATEV-Export geschlossen, GiroCode aus dem PDF zurückgelesen,
Endpreis bleibt exakt erhalten (online 117,00 ergibt 117,00 auf der Rechnung), Ländercode als
Snapshot in E-Rechnung. 61 automatisierte Tests. Nachweis:
`.claude/bereiche/rechnungswesen/RELEASE-2026-08-29.md`.

## Von anderen Bereichen behoben

Preisangabenverordnung: Der Buchungsassistent zeigte dem Verbraucher Nettopreise
(41,18 statt 49,00) — behoben, jetzt Endpreise. Datenschutzerklärung deckt die Gast-Buchung
ab (Art. 13). Firmenname und Anschrift lassen sich in den Einstellungen nicht mehr leeren
(§ 5 DDG, sonst wäre das Impressum unvollständig geworden). Unterschriebene Kundendokumente
sind per Trigger unlöschbar. Keine Cookies, keine fremden Server, kein Tracking — geprüft.

## Entscheidungen, die nur der Inhaber treffen kann

1. Monatsarchiv einschalten und Belege verschlüsselt außer Haus sichern (Punkte 7, 8, 12).
   Beides sind Eingriffe in Cronjobs und ein fremdes Skript.
2. Verbraucherschlichtung: Im Impressum steht fest „nicht bereit teilzunehmen". Stimmt das
   nach der Gründung noch, insbesondere bei Beitritt zur Kfz-Innung?
3. Handwerksrolle: Ist der Betrieb eingetragen? Dann fehlen im Impressum Kammer,
   Berufsbezeichnung und berufsrechtliche Regelungen (§ 5 Abs. 1 Nr. 5 DDG).
4. Löschfristen für Gast-Termine und Kontaktanfragen festlegen (Vorschlag: Kontaktanfragen
   6 Jahre, stornierte Gast-Termine ohne Rechnungsbezug 12 Monate).
5. Barzahlung: ob und ab wann — davon hängt die gesamte Kassenpflicht ab.
