# ReifenPro — Kompletter Test-Ablauf (Durchspielen)

Stand: 2026-06-16. Vor dem Go-live abarbeiten. Tipp: vor jedem Bereich einmal
**Strg/Cmd + Shift + R** (Cache leeren). Bei Problemen: Browser-Konsole mit **F12**
öffnen, rote Fehler notieren und melden (z. B. „8.3 Etikettendruck").

## Zugänge
- Homepage:       https://www.schroeder-scholz.de/
- Kundenportal:   https://www.schroeder-scholz.de/portal/
- Admin:          https://admin.schroeder-scholz.de/   (Login: david.gebray@icloud.com)
- CMS:            https://admin.schroeder-scholz.de/cms.html  (gleicher Login)
- Portal-Testkunde:  testkunde@schroeder-scholz.de  /  Testkunde2026!
- Demo-Gutschein:    SAISON10 (10 %)
- Demo-Rechnungen:   RE-2026-0001 bis 0006 + 1 Entwurf (RE-2026-0001 ist überfällig → Mahnwesen)
- Sandbox: 30 Kunden, 100 Einlagerungen, 40 Termine, 2 offene Kontaktanfragen

Falls Admin-Passwort unbekannt: Login-Seite → „Passwort vergessen?" → Mail an
david.gebray@icloud.com (auch Spam prüfen, Absender info@reifen-penzberg.de) → neues setzen.

---

## 1. Homepage
- [ ] Startseite öffnen. Erwartet: Logo wie im Portal (SCHRÖDER & SCHOLZ + gelber Balken + „REIFENSERVICE UND FAHRZEUGTECHNIK"), Hero-Bild, 5 Leistungs-Kacheln mit Bildern, Über-uns, Öffnungszeiten, Kontakt.
- [ ] `http://schroeder-scholz.de` (ohne www) → leitet auf `https://www.schroeder-scholz.de`.
- [ ] Hero-Button „Termin online buchen" → öffnet Portal mit **Login-Maske** (Stammkunden), darunter „Jetzt registrieren".

## 2. Kontaktformular → Dashboard → Antwort
- [ ] Homepage unten „Kontakt": Formular OHNE Datenschutz-Haken absenden → Fehlermeldung.
- [ ] Mit eigener E-Mail + Haken absenden → „Vielen Dank …".
- [ ] Admin → Dashboard: Hinweis „X offene Kontaktanfragen".
- [ ] Admin → „Kontaktanfragen": deine Anfrage steht oben → „Antworten" (Text ist mit Anrede/Gruß vorausgefüllt) → „Antwort senden".
- [ ] Erwartet: Anfrage wird „erledigt"; Antwort-Mail kommt in deinem Postfach an.

## 3. CMS (Homepage verwalten)
- [ ] CMS öffnen, einloggen. Erwartet: Logo oben, aufklappbare Abschnitte.
- [ ] Abschnitt antippen → Text ändern → „Speichern" → Homepage in neuem Tab prüfen.
- [ ] Bei einer Leistung „Bild auswählen" → Foto hochladen → Vorschau im Zuschnitt → auf Homepage sichtbar.
- [ ] „Sichtbar"-Schalter aus → Homepage: Abschnitt weg → wieder an.
- [ ] Reihenfolge mit Pfeilen ändern → Homepage prüfen.
- [ ] Bereich „Gutscheine": Gutschein `SAISON10` ist da. Neuen anlegen (Code + Rabatt %) → erscheint in der Liste.
- [ ] Bereich „Aktionsbanner": Haken setzen, Text + Code `SAISON10`, Position „Leiste oben", speichern → Homepage: Banner oben sichtbar, Button führt zur Buchung. Position auf „Ecke" testen. Danach ggf. wieder ausschalten.

## 4. Kundenportal (Testkunde)
- [ ] Über Homepage „Termin buchen" → Login-Maske → mit Testkunde anmelden → **landet direkt auf „Termin buchen"**.
- [ ] Termin buchen: Datum/Leistung/Uhrzeit wählen → buchen → Bestätigung. (Im Admin-Kalender taucht er auf.)
- [ ] „Meine Einlagerungen": Liste sichtbar.
- [ ] „Meine Termine": gebuchter Termin sichtbar → „Verschieben" testen → „Stornieren" testen.
- [ ] „Rechnungen": Demo-Rechnungen sichtbar, PDF öffnet.
- [ ] „Mein Profil" → „Passwort ändern": neues Passwort (mind. 8 Zeichen) → speichern. **WICHTIG (Datenverlust-Fix):** danach Telefon/Kennzeichen unter „Meine Daten" prüfen — müssen unverändert sein. (Passwort danach wieder auf Testkunde2026! ändern, damit der Testzugang stimmt.)
- [ ] Sprache DE/EN umschalten. Abmelden.
- [ ] Falsches Passwort beim Login → klare Fehlermeldung (nicht „nichts passiert").

## 5. Admin — Login & Sicherheit
- [ ] Login mit falschem Passwort → Meldung „E-Mail oder Passwort ist falsch." (nicht stumm).
- [ ] Login korrekt → Dashboard.
- [ ] Abmelden testen (kein Hängenbleiben / keine Endlosschleife).
- [ ] Irgendwo im Admin Strg/Cmd+P drücken → es darf KEIN leeres Blatt drucken (Druck nur über die Buttons).

## 6. Admin — Kunden
- [ ] „Kunden": ~30 Einträge. Suche nach Name/Kennzeichen/Nr.
- [ ] Kunde öffnen: Stammdaten, Einlagerungen, Termine.
- [ ] Bei einem Portal-Kunden „Freigabe" (Dashboard-Hinweis „neue Portal-Kunden"): Freischalten testen.
- [ ] Kunde → „Datenschutz" → unterschreiben (mit Maus/Finger) → **Speichern**. **WICHTIG (Layout-Fix):** danach ist die Admin-Seite NICHT verzogen/mittig-schmal.
- [ ] Kunde → „Vertrag" → öffnen/drucken.

## 7. Admin — Einlagerung (mit Kundensuche!)
- [ ] „+ Neue Einlagerung": im Feld **Kunde** tippen (Name/Kennzeichen) → Trefferliste → auswählen. (Das war vorher ein reines Dropdown.)
- [ ] Reifendaten + (automatischer) Lagerplatz → speichern.
- [ ] „Lagerplan": Belegung sichtbar (belegt/frei).
- [ ] Status einer Einlagerung auf „Abholbereit"/„Abgeholt" setzen.

## 8. Admin — Etiketten (100 × 50 mm)
- [ ] Einlagerung → „Etikett drucken": Druckvorschau zeigt 4 Etiketten (VL/VR/HL/HR), jedes füllt die 100×50-Fläche: oben Kennzeichen + große Position, Mitte großer Lagerplatz, unten Reifeninfo + Barcode.
- [ ] Auf dem Etikettendrucker testen: Format passt randlos auf die 100×50-Rolle.

## 9. Admin — Kalender & Werkstatt
- [ ] „Kalender": Monats-/Wochen-/Tagesansicht. Termine erscheinen am RICHTIGEN Tag (kein Vortag).
- [ ] „+ Termin": **Kunde suchen** (Suchfeld) → auswählen → Datum/Leistung → speichern.
- [ ] Einen Termin **bearbeiten** (Datum ändern) → speichern. **WICHTIG (Fix):** es entsteht KEIN zweiter/doppelter Termin, der bestehende wird geändert.
- [ ] Termin „Absagen" → Status storniert.
- [ ] „Werkstatt": offene Termine, einen auf „erledigt" setzen.

## 10. Admin — Rechnungen
- [ ] „Rechnungen": RE-2026-0001…0006 + 1 Entwurf.
- [ ] Rechnung öffnen → „PDF ansehen" (korrekt). Hinweis: vollständige Pflichtangaben erscheinen erst, wenn Firmendaten/Steuernr./IBAN eingetragen sind (siehe 15).
- [ ] „Neue Rechnung": **Kunde suchen** → Position(en) hinzufügen.
- [ ] **Gutschein anwenden**: Code `SAISON10` ins Feld → „Gutschein anwenden" → Rabattzeile (−10 %) erscheint, Summe sinkt.
- [ ] „Als Entwurf speichern" → dann „Festschreiben" → bekommt Nummer (RE-2026-00xx) + PDF.
- [ ] Rechnung aus einem **abgeschlossenen Termin** erzeugen.
- [ ] RE-2026-0001 (überfällig) → „Mahnung" durchspielen.
- [ ] Eine Rechnung „Stornieren" → Stornorechnung mit eigener Nummer.
- [ ] Eine Rechnung als „bezahlt" markieren.
- [ ] „Statistik": Umsatz / offene Posten plausibel.

## 11. Admin — Kontaktanfragen
- [ ] Liste der Anfragen (2 Demo + ggf. deine aus Schritt 2). „Antworten" mit vorausgefülltem Text → senden → wird „erledigt".
- [ ] Filter „erledigte anzeigen".

## 12. Admin — Rest
- [ ] „Statistik": Auslastung/Diagramme.
- [ ] „Mitarbeiter": Liste; ggf. Testmitarbeiter anlegen und wieder löschen.
- [ ] „DSGVO-Anfragen": Ansicht.
- [ ] „Einstellungen": Öffnen, Felder sichtbar (hier kommen später die Firmendaten rein).

## 13. Mobile
- [ ] Homepage, Portal und Admin auf dem Handy öffnen: Layout sauber, Menü/Navigation funktioniert, Formulare bedienbar.

## 14. Vor dem Go-live
1. [ ] **Einstellungen ausfüllen:** Firmenname, Adresse, Telefon, **E-Mail** (Ziel der Kontaktanfragen!), Öffnungszeiten, **Steuernr./USt-IdNr., Rechtsform, IBAN/BIC** (für §14-konforme Rechnungen, Karte, Impressum).
2. [ ] (Optional) SMTP-Absender auf eine @schroeder-scholz.de-Adresse umstellen (aktuell info@reifen-penzberg.de) — sag Bescheid.
3. [ ] **Sandbox zurücksetzen** (löscht alle Testdaten, Nummern starten bei 1):
   ```
   sudo -u postgres psql -d reifenpro -f /var/www/reifenpro-backend/reset-sandbox.sql
   rm -f /var/www/reifenpro-backend/rechnungen/*.pdf
   ```
   (Auf Wunsch übernehme ich das.)
4. [ ] Nach dem Reset eine echte Probe-Einlagerung + Rechnung anlegen und wieder löschen.

---

Notizen (was hakt / Auffälligkeiten):
- 
- 
