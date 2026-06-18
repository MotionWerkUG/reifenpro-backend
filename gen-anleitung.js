'use strict';
// Erzeugt die ReifenPro-Bedienungsanleitung als PDF (pdfkit). Ausgabe: /tmp/anleitung.pdf
// Auf dem Server ausfuehren: cd /var/www/reifenpro-backend && node gen-anleitung.js
const PDFDocument = require('pdfkit');
const fs = require('fs');

const ACCENT = '#e8502a';
const DARK = '#171717';
const GREY = '#666666';
const LIGHT = '#999999';
const ZIEL = process.argv[2] || '/tmp/anleitung.pdf';

// ── INHALT ──────────────────────────────────────────────────────────────────
// Bloecke: {p}=Absatz, {h}=Unterueberschrift (kommt ins Inhaltsverzeichnis),
// {steps:[...]}=nummerierte Schritte, {bullets:[...]}=Aufzaehlung, {note}=Hinweisbox
const KAPITEL = [
  { t: 'Einführung', body: [
    { p: 'Dieses Handbuch erklärt die Bedienung des ReifenPro-Systems von Schröder & Scholz Schritt für Schritt und in einfacher Sprache. Es ist nach Bereichen gegliedert; über das Inhaltsverzeichnis springen Sie direkt zum gewünschten Thema.' },
    { h: 'Die drei Bereiche des Systems' },
    { bullets: [
      'Admin-Bereich (für Sie und Ihre Mitarbeiter): Kunden, Einlagerungen, Kalender, Werkstatt, Rechnungen, Statistik, Einstellungen. Aufruf im Browser: admin.schroeder-scholz.de',
      'Homepage-Baukasten (CMS): Inhalte der öffentlichen Webseite bearbeiten. Aufruf: admin.schroeder-scholz.de/cms.html',
      'Öffentliche Webseite & Kundenportal (für Ihre Kunden): Startseite www.schroeder-scholz.de, Online-Terminbuchung www.schroeder-scholz.de/termin/, Kundenportal www.schroeder-scholz.de/portal/'
    ] },
    { note: 'Anmeldedaten und Passwörter erhalten Sie separat. Geben Sie Zugangsdaten niemals weiter und nutzen Sie ein sicheres Passwort.' }
  ] },

  { t: 'Anmeldung im Admin-Bereich', body: [
    { steps: [
      'Öffnen Sie im Browser die Adresse admin.schroeder-scholz.de',
      'Geben Sie Ihre E-Mail-Adresse und Ihr Passwort ein.',
      'Klicken Sie auf „Anmelden". Sie sehen danach das Dashboard.'
    ] },
    { p: 'Über das Menü am linken Rand wechseln Sie zwischen den Bereichen. Zum Abmelden nutzen Sie die Abmelden-Funktion oben.' }
  ] },

  { t: 'Dashboard (Startseite)', body: [
    { p: 'Das Dashboard zeigt auf einen Blick die wichtigsten Kennzahlen und Hinweise.' },
    { bullets: [
      'Kacheln mit Anzahl der Einlagerungen und Kunden (anklickbar – führen direkt in den jeweiligen Bereich).',
      'Hinweis auf neue Portal-Kunden, die freigeschaltet werden möchten.',
      'Hinweis auf offene Kontaktanfragen und offene Gewerbe-Anfragen.',
      'Letzte Einlagerungen, heutige Termine und die letzte Aktivität.'
    ] }
  ] },

  { t: 'Kunden verwalten', body: [
    { p: 'Im Menüpunkt „Kunden" sehen Sie alle Kunden, suchen nach Name, Kundennummer, Kennzeichen, Telefon oder E-Mail und legen neue Kunden an.' },
    { h: 'Neuen Kunden anlegen' },
    { steps: [
      'Klicken Sie auf „+ Neuer Kunde".',
      'Wählen Sie die Anrede (Herr/Frau/Firma/Divers) und den Kundentyp (Privatkunde oder Firmenkunde).',
      'Bei Firmenkunden: tragen Sie den Firmennamen und – falls vorhanden – die USt-IdNr. ein. Setzen Sie bei Bedarf den Haken „Als Gewerbekunde (Sonderkonditionen)".',
      'Füllen Sie Vorname, Nachname und Telefon (Pflicht) sowie E-Mail und Anschrift aus.',
      'Optional: Fahrzeugdaten und Kennzeichen (Format WOR-AB-1234) erfassen.',
      'Lassen Sie den Haken „Datenschutzerklärung sofort erstellen" gesetzt (Pflicht beim ersten Kundenkontakt) und klicken Sie auf „Speichern".'
    ] },
    { h: 'Kundendetails und Dokumente' },
    { p: 'Klicken Sie einen Kunden an, um Details zu sehen. Dort erzeugen Sie Dokumente zum Unterschreiben:' },
    { bullets: [
      'Datenschutz: erzeugt die Datenschutzerklärung (DSGVO Art. 13). Der Kunde unterschreibt auf dem Bildschirm; die Unterschrift wird gespeichert.',
      'Vertrag: erzeugt den Einlagerungs-/Auftragsvertrag (dient zugleich als AGB-Beleg).'
    ] },
    { h: 'Gewerbekunden und Sonderkonditionen' },
    { p: 'Bei einem als Gewerbekunde markierten Kunden hinterlegen Sie in der Kundenakte die Konditionen: einen prozentualen Pauschalrabatt und/oder feste Preise je Leistung. Diese Preise werden bei der Rechnungserstellung automatisch verwendet.' }
  ] },

  { t: 'Einlagerung (Räder einlagern)', body: [
    { p: 'Unter „Einlagerung" erfassen Sie eingelagerte Räder und finden bestehende Einlagerungen wieder.' },
    { steps: [
      'Klicken Sie auf „+ Neue Einlagerung".',
      'Wählen Sie den Kunden (Suchfeld) oder legen Sie ihn vorher an.',
      'Erfassen Sie Reifendaten: Dimension (z.B. 205/55 R16 91W), Typ (Winter/Sommer/Ganzjahr), Marke, Profiltiefe, ggf. DOT.',
      'Vergeben Sie einen Lagerplatz (siehe Lagerplan) und speichern Sie.'
    ] },
    { p: 'Den Status einer Einlagerung (Eingelagert / Abholbereit / Abgeholt) ändern Sie in der Liste bzw. in den Details. Für jede Einlagerung können Sie einen Einlagerungsschein erzeugen.' }
  ] },

  { t: 'Lagerplan', body: [
    { p: 'Der Lagerplan zeigt Ihre Lagerplätze grafisch und welche belegt bzw. frei sind. Die verfügbaren Lagerorte legen Sie in den Einstellungen an. So behalten Sie den Überblick, wo welche Räder liegen.' }
  ] },

  { t: 'Kalender und Termine', body: [
    { p: 'Im „Kalender" sehen Sie alle Termine in Monats-, Wochen- oder Tagesansicht.' },
    { bullets: [
      'Termine entstehen durch Online-Buchungen (Webseite) oder werden hier manuell angelegt.',
      'Status: angefragt, bestätigt, abgeschlossen, storniert. Sammeltermine von Gewerbekunden kommen als „angefragt" und müssen von Ihnen bestätigt werden.',
      'Einen Termin anklicken, um Details zu sehen, zu verschieben oder abzusagen (bei Online-Buchungen wird der Kunde per E-Mail informiert).'
    ] },
    { note: 'Welche Uhrzeiten online buchbar sind, steuern Sie über die Öffnungszeiten in den Einstellungen.' }
  ] },

  { t: 'Werkstatt', body: [
    { p: 'Die Werkstatt-Ansicht ist für den Arbeitsalltag gedacht: Sie zeigt die anstehenden Termine/Aufträge übersichtlich, damit Mitarbeiter sehen, was zu tun ist, und Aufträge als erledigt markieren können.' }
  ] },

  { t: 'Rechnungen', body: [
    { p: 'Unter „Rechnungen" erstellen, verwalten und exportieren Sie Ihre Ausgangsrechnungen. Eine Rechnung ist zunächst ein Entwurf und kann beliebig geändert werden. Erst mit dem Festschreiben wird sie verbindlich und unveränderbar.' },
    { h: 'Rechnung erstellen' },
    { steps: [
      'Klicken Sie auf „+ Neue Rechnung".',
      'Empfänger: Entweder einen bestehenden Kunden auswählen (die Felder füllen sich automatisch) ODER einen Empfänger frei eintragen (Anrede, Vorname, Nachname, Firma, Adresse). Auch Laufkundschaft ohne Kundenkonto ist möglich.',
      'Positionen erfassen: per „Artikel übernehmen" eine Leistung wählen (Preis wird vorbelegt, bei Gewerbekunden mit Sonderpreis) oder „+ Freie Position" für eine eigene Zeile.',
      'Optional einen Gutschein-Code anwenden.',
      'Auf „Als Entwurf speichern" klicken.'
    ] },
    { h: 'Daten in den Kundenstamm übernehmen / neuen Kunden anlegen' },
    { bullets: [
      'Haben Sie bei einem ausgewählten Kunden die Empfängerdaten geändert, fragt das System nach dem Speichern, ob die Änderungen in den Kundenstamm übernommen werden sollen.',
      'Haben Sie einen neuen Empfänger frei eingetragen, fragt das System, ob daraus ein Kunde angelegt werden soll. Danach können Sie Datenschutzerklärung und Vertrag erzeugen und unterschreiben lassen.'
    ] },
    { h: 'Festschreiben, PDF, Storno, Bezahlt, Mahnung' },
    { steps: [
      'Festschreiben: vergibt die fortlaufende Rechnungsnummer (Format RE-JJJJ-NNNN), erzeugt das PDF und sperrt die Rechnung gegen Änderungen. Vorher prüft das System die Pflichtangaben (§ 14 UStG): Empfänger, ab 250 € die vollständige Anschrift sowie Ihre Steuernummer oder USt-IdNr.',
      'PDF: zeigt bzw. öffnet die Rechnung als PDF (mit Bezahl-QR-Code).',
      'Als bezahlt / Als offen: setzt den Zahlungsstatus.',
      'Mahnen: versendet eine Zahlungserinnerung bzw. Mahnung per E-Mail.',
      'Storno: erzeugt eine Stornorechnung mit eigener Nummer; das Original bleibt erhalten und wird als „storniert" gekennzeichnet (Rechnungen werden nie gelöscht).'
    ] },
    { h: 'GoBD: Export und Verfahrensdokumentation' },
    { bullets: [
      'CSV-Export (GoBD): lädt das Rechnungsjournal eines Jahres als CSV-Datei herunter – z.B. für den Steuerberater oder eine Betriebsprüfung.',
      'Verfahrensdoku: öffnet eine druckbare Verfahrensdokumentation (Beschreibung des Rechnungsprozesses). Diese sollten Sie aufbewahren und vom Steuerberater prüfen lassen.'
    ] },
    { note: 'Wichtig: Damit Rechnungen rechtlich vollständig sind, müssen in den Einstellungen Ihre Firmendaten inkl. Steuernummer oder USt-IdNr. und Bankverbindung hinterlegt sein.' }
  ] },

  { t: 'Kontaktanfragen', body: [
    { p: 'Nachrichten über das Kontaktformular der Webseite landen unter „Kontaktanfragen". Sie können direkt aus der Liste per E-Mail antworten (der Antworttext ist mit Anrede und Grußformel vorbereitet) und Anfragen als erledigt markieren.' }
  ] },

  { t: 'Gewerbe-Anfragen', body: [
    { p: 'Interessenten, die über die Webseite einen Gewerbe-Zugang anfragen, erscheinen unter „Gewerbe-Anfragen".' },
    { steps: [
      'Anfrage öffnen und Angaben prüfen (Firma, Ansprechpartner, USt-IdNr., Anzahl Fahrzeuge).',
      'Falls hochgeladen: „Gewerbeanmeldung ansehen" öffnet das Dokument (wird sicher und nicht öffentlich gespeichert).',
      '„Kunde anlegen" übernimmt die Daten in ein neues Kundenkonto (als Gewerbekunde). Anschließend Konditionen hinterlegen und Dokumente unterschreiben lassen.',
      'Erledigte Anfragen werden automatisch markiert; Sie können sie auch manuell auf erledigt/offen setzen.'
    ] }
  ] },

  { t: 'Statistik', body: [
    { p: 'Die Statistik zeigt Auswertungen wie Umsatz, offene Posten und Auslastung. So erkennen Sie Entwicklungen und saisonale Spitzen.' }
  ] },

  { t: 'Mitarbeiter', body: [
    { p: 'Unter „Mitarbeiter" verwalten Sie die Benutzerkonten Ihres Teams (anlegen, Rolle/Rechte, deaktivieren). Jeder Mitarbeiter meldet sich mit eigenem Konto an; wichtige Vorgänge werden protokolliert.' }
  ] },

  { t: 'DSGVO-Anfragen', body: [
    { p: 'Hier bearbeiten Sie Auskunfts- und Löschanträge von Kunden (DSGVO Art. 15 und 17). Bei einer Löschung beachtet das System die gesetzlichen Aufbewahrungspflichten: Daten, die zu Rechnungen gehören, bleiben für die Aufbewahrungsfrist erhalten.' }
  ] },

  { t: 'Einstellungen', body: [
    { p: 'Die „Einstellungen" sind die zentrale Schaltstelle. Tragen Sie hier zuerst Ihre Stammdaten ein, bevor Sie Rechnungen schreiben.' },
    { h: 'Firmendaten und Bankverbindung' },
    { p: 'Firmenname, Inhaber, Anschrift, Telefon, E-Mail, Steuernummer oder USt-IdNr. sowie Bankverbindung (IBAN/BIC). Diese Daten erscheinen auf Rechnungen und im Impressum.' },
    { h: 'Artikel/Leistungen und Preis-Staffeln' },
    { steps: [
      'Im Bereich „Artikel" legen Sie jede Leistung an: Name, Preis (Sie geben den Brutto-Preis ein, netto wird berechnet), MwSt-Satz, Einheit und – wichtig – die Dauer in Minuten.',
      'Die Dauer bestimmt, wie lange ein Termin-Slot bei der Online-Buchung blockiert wird.',
      'Über „Staffel" hinterlegen Sie abweichende Preise je Fahrzeugart (z.B. SUV) und/oder Zollbereich. Der „ab"-Preis auf der Buchungsseite ist immer der günstigste; der Mehrpreis erscheint als gesonderter Zuschlag.'
    ] },
    { h: 'Lagerplätze' },
    { p: 'Legen Sie Ihre Lagerorte an; diese stehen dann bei der Einlagerung und im Lagerplan zur Verfügung.' },
    { h: 'Öffnungszeiten und Termine' },
    { p: 'Öffnungszeiten Mo–Fr, Samstag, Sonntag, Mittagspause und „maximale parallele Termine". Diese Angaben steuern, welche Uhrzeiten online buchbar sind.' },
    { h: 'Betriebsurlaub' },
    { p: 'Tragen Sie Urlaubs-/Schließzeiträume ein. An diesen Tagen ist online keine Buchung möglich.' },
    { h: 'Aktionsbanner und Gutscheine' },
    { p: 'Aktionsbanner und Gutscheine werden – je nach Aufbau – in den Einstellungen bzw. im Homepage-Baukasten gepflegt und auf der Webseite angezeigt.' }
  ] },

  { t: 'Homepage-Baukasten (CMS)', body: [
    { p: 'Den Baukasten öffnen Sie über admin.schroeder-scholz.de/cms.html. Damit bearbeiten Sie Ihre öffentliche Webseite ohne Programmierkenntnisse. Änderungen werden sofort übernommen.' },
    { h: 'Visuelle Vorschau und Bearbeiten' },
    { steps: [
      'Oben „Visuelle Vorschau" wählen – Sie sehen Ihre Startseite.',
      'Klicken Sie in der Vorschau einen Bereich an, um Überschrift, Text und Bild zu bearbeiten.',
      'Mit „Einstellungen & Listen" wechseln Sie zur Listenansicht aller Bereiche.'
    ] },
    { h: 'Abschnitte, Texte und Bilder' },
    { p: 'Pro Abschnitt ändern Sie Überschrift und Text und laden ein Bild hoch (wird automatisch passend zugeschnitten). Abschnitte lassen sich ein-/ausblenden und in der Reihenfolge verschieben.' },
    { h: 'Navigationsbuttons' },
    { p: 'Im Panel „Navigationsbuttons" bearbeiten Sie die Menüpunkte der Startseite: Beschriftung, Ziel (z.B. #leistungen oder /termin/), Reihenfolge, Sichtbarkeit und ob ein Punkt als hervorgehobener Button erscheint.' },
    { h: 'Buchungs-Leistungen (Bild und Text)' },
    { p: 'Im Panel „Buchungs-Leistungen" legen Sie fest, welche Leistungen im Online-Buchungsassistenten als Haupt- bzw. Zusatzleistung erscheinen, und hinterlegen je Leistung eine Kurzbeschreibung und ein Bild. Diese ersetzen die Platzhalter auf der Buchungsseite.' },
    { h: 'Änderungen rückgängig machen' },
    { p: 'Mit „Rückgängig" machen Sie die letzte Änderung an einem Abschnitt rückgängig.' },
    { note: 'Hinweis: Hochgeladene Bilder erscheinen in der Vorschau über die öffentliche Adresse. Die rechtlich generierten Seiten (Datenschutz, AGB) werden bewusst nicht über den Baukasten frei bearbeitet.' }
  ] },

  { t: 'Online-Terminbuchung (Kundensicht)', body: [
    { p: 'Ihre Kunden buchen Termine unter www.schroeder-scholz.de/termin/ in vier Schritten. So sieht der Ablauf für den Kunden aus:' },
    { steps: [
      'Schritt 1 – Leistungen: eine oder mehrere Hauptleistungen wählen (mit „ab"-Preis, Bild und Kurztext).',
      'Schritt 2 – Zusatzleistungen: optional ergänzen.',
      'Schritt 3 – Fahrzeug & Termin: Fahrzeugart (PKW/SUV/…) und optional Zollgröße wählen, Kennzeichen eingeben, Datum und freie Uhrzeit wählen.',
      'Schritt 4 – Ihre Daten: Anrede, Vor-/Nachname, Telefon, E-Mail und Anschrift; es erscheint eine Preis-Schätzung mit gesondert ausgewiesenem Fahrzeug-Zuschlag. Nach Bestätigung der Datenschutz-Kenntnisnahme wird verbindlich gebucht.'
    ] },
    { p: 'Der Kunde und Sie erhalten eine Bestätigung per E-Mail; der Termin erscheint in Ihrem Kalender.' },
    { note: 'Die Preise sind eine unverbindliche Schätzung. Endpreise können je nach Aufwand abweichen – das steht auch für den Kunden dabei.' }
  ] },

  { t: 'Kundenportal (Kundensicht)', body: [
    { p: 'Im Kundenportal (www.schroeder-scholz.de/portal/) sehen Ihre Kunden ihre Daten und buchen Termine.' },
    { h: 'Registrierung und Freischaltung' },
    { steps: [
      'Der Kunde registriert sich mit E-Mail und Passwort und bestätigt seine E-Mail-Adresse.',
      'Sie sehen den neuen Kunden im Dashboard und schalten ihn frei (Button „Freigeben"). Erst danach kann er sich anmelden.'
    ] },
    { h: 'Funktionen für den Kunden' },
    { bullets: [
      'Einlagerungen einsehen (welche Räder, Saison, Lagerplatz, Status).',
      'Fahrzeuge/Fuhrpark verwalten; je Fahrzeug werden die eingelagerten Räder angezeigt.',
      'Rechnungen ansehen.',
      'Termine buchen, verschieben oder stornieren.'
    ] },
    { h: 'Gewerbekunden: Sammeltermin' },
    { p: 'Als Gewerbekunde markierte Portal-Nutzer können einen Sammeltermin für mehrere Fahrzeuge anfragen. Dieser kommt bei Ihnen als „angefragt" an und wird von Ihnen terminiert/bestätigt. Einzeltermine sind wie bei Privatkunden sofort bestätigt.' }
  ] },

  { t: 'Gewerbe-Zugang anfragen (Kundensicht)', body: [
    { p: 'Gewerbekunden registrieren sich nicht selbst, sondern fragen einen Zugang an. Auf der Anmeldeseite des Portals gibt es dafür „Sie sind Gewerbekunde? Zugang anfragen". Der Interessent füllt Firma, Ansprechpartner und Kontakt aus, lädt optional die Gewerbeanmeldung hoch und stimmt dem Datenschutz zu. Die Anfrage erscheint bei Ihnen unter „Gewerbe-Anfragen".' }
  ] },

  { t: 'Werbe-Einwilligung (Double-Opt-in)', body: [
    { p: 'Saisonale Erinnerungen (Reifenwechsel) dürfen Sie nur an Kunden senden, die ausdrücklich zugestimmt UND die Zustimmung per Klick bestätigt haben (Double-Opt-in).' },
    { bullets: [
      'Stimmt ein Kunde bei der Portal-Registrierung zu, erhält er automatisch eine Bestätigungsmail. Erst nach Klick auf den Link gilt die Einwilligung.',
      'Mit dem Button „Werbe-Einwilligung bestätigen lassen" (im Bereich Kunden) fordern Sie alle, die zugestimmt aber noch nicht bestätigt haben, erneut zur Bestätigung auf. Dabei werden keine Kundendaten gelöscht.',
      'Wer trotz Aufforderung nicht bestätigt, erhält keine Werbung mehr. Reine Werbe-/Altdaten ohne Geschäftsbeziehung werden nach Ablauf der Frist automatisch entfernt; Daten mit Rechnung/Vertrag bleiben aufgrund der Aufbewahrungspflicht erhalten.'
    ] }
  ] },

  { t: 'Rechtliches: was die Software tut – und was Sie tun müssen', body: [
    { p: 'Die Software setzt zentrale Pflichten technisch um. Für die vollständige Rechtssicherheit sind zusätzlich Inhalte, Verträge und eine fachliche Prüfung nötig. Dieses Kapitel ist keine Rechtsberatung.' },
    { h: 'Von der Software abgedeckt' },
    { bullets: [
      'Rechnungen (§ 14 UStG): fortlaufende, lückenlose Nummern, Pflichtangaben-Prüfung, Unveränderbarkeit nach Festschreiben, Storno statt Löschen.',
      'GoBD: Unveränderbarkeit, Protokollierung, Aufbewahrung der PDF, CSV-Export, Verfahrensdokumentation (Vorlage).',
      'Datenschutz: Terminbuchung auf Vertragsgrundlage, dokumentierte Datenschutz-Kenntnisnahme, getrennte und bestätigte Werbe-Einwilligung, Löschkonzept für Altdaten.'
    ] },
    { h: 'Von Ihnen zu erledigen' },
    { bullets: [
      'Stammdaten eintragen (Steuernummer/USt-IdNr., Bankverbindung).',
      'Datenschutzerklärung und AGB inhaltlich vollständig halten und anwaltlich prüfen lassen.',
      'Auftragsverarbeitungsverträge mit den Dienstleistern (Hosting, E-Mail) abschließen.',
      'Datensicherung (Backups) organisieren und die Verfahrensdokumentation finalisieren.',
      'Einmalige Gegenprüfung durch Steuerberater und Datenschutzbeauftragten/Anwalt.'
    ] }
  ] },

  { t: 'Checkliste vor dem Go-live', body: [
    { bullets: [
      'Firmendaten, Steuernummer/USt-IdNr. und Bankverbindung in den Einstellungen eingetragen.',
      'Artikel mit echten Preisen, MwSt und Dauer angelegt; Fahrzeug-Staffeln (z.B. SUV) hinterlegt.',
      'Buchungs-Leistungen mit echten Texten und Fotos versehen (Demo-Platzhalter ersetzt).',
      'Öffnungszeiten, Mittagspause und maximale parallele Termine korrekt gesetzt.',
      'Lagerplätze angelegt.',
      'Datenschutzerklärung und AGB geprüft; AV-Verträge abgeschlossen.',
      'Testbuchung und Testrechnung einmal komplett durchgespielt.',
      'Sandbox-/Testdaten entfernt (Reset) und Backups eingerichtet.'
    ] },
    { note: 'Bei Fragen oder Anpassungen wenden Sie sich an Ihre technische Betreuung.' }
  ] }
];

// ── PDF-AUFBAU ───────────────────────────────────────────────────────────────
const doc = new PDFDocument({ size: 'A4', autoFirstPage: false, margins: { top: 64, bottom: 64, left: 64, right: 64 }, bufferPages: true });
doc.pipe(fs.createWriteStream(ZIEL));
const L = doc.page ? doc.page.margins.left : 64;
const PW = 595.28, PH = 841.89, ML = 64, MR = 64, MT = 64, MB = 64;
const CW = PW - ML - MR;
const BOTTOM = PH - MB;

let curPage = 0;
doc.on('pageAdded', function () { curPage++; });

function need(h) { if (doc.y + h > BOTTOM) doc.addPage(); }

// Inhaltsverzeichnis-Eintraege (werden beim Rendern mit Seitenzahl gefuellt)
const toc = [];
KAPITEL.forEach(function (k, i) {
  toc.push({ lvl: 1, label: (i + 1) + '. ' + k.t, page: 0, ref: k });
  (k.body || []).forEach(function (b) { if (b.h) toc.push({ lvl: 2, label: b.h, page: 0, ref: b }); });
});

// Deckblatt (Seite 1)
doc.addPage();
doc.rect(0, 0, PW, 220).fill(DARK);
doc.fill('#ffffff').font('Helvetica-Bold').fontSize(30).text('SCHRÖDER', ML, 70);
doc.fill(ACCENT).text('& SCHOLZ', ML, 106);
doc.fill('#bbbbbb').font('Helvetica').fontSize(11).text('REIFENSERVICE UND FAHRZEUGTECHNIK', ML, 150);
doc.fill(DARK).font('Helvetica-Bold').fontSize(26).text('ReifenPro', ML, 300);
doc.fontSize(20).fill(DARK).text('Bedienungsanleitung', ML, 336);
doc.font('Helvetica').fontSize(12).fill(GREY).text('Vollständiger Leitfaden für Admin-Bereich, Homepage-Baukasten und Kundenportal', ML, 372, { width: CW });
doc.fontSize(10).fill(LIGHT).text('Stand: ' + (process.argv[3] || ''), ML, 760);

// Inhaltsverzeichnis-Seiten reservieren
const LH = 19;
const perPage = Math.floor((BOTTOM - (MT + 50)) / LH);
const tocPages = Math.max(1, Math.ceil((toc.length + 1) / perPage));
const tocStartIndex = curPage; // 0-basiert: Index der ersten IV-Seite
for (var tp = 0; tp < tocPages; tp++) doc.addPage();

// Inhalt rendern
function heading1(text, isFirst) {
  if (isFirst) {
    doc.addPage();
  } else if (doc.y + 130 > BOTTOM) {
    doc.addPage(); // nicht genug Platz fuer Ueberschrift + Einstieg -> neue Seite
  } else {
    // genug Platz: Kapitel auf derselben Seite fortsetzen, mit dezenter Trennung
    doc.moveDown(1.1);
    doc.moveTo(ML, doc.y).lineTo(ML + CW, doc.y).lineWidth(0.5).stroke('#e2e2e2');
    doc.moveDown(1.0);
  }
  doc.font('Helvetica-Bold').fontSize(16).fill(DARK).text(text, ML, doc.y);
  doc.moveTo(ML, doc.y + 3).lineTo(ML + CW, doc.y + 3).lineWidth(2).stroke(ACCENT);
  doc.moveDown(0.8);
  doc.fill('#000');
}
function heading2(text) {
  need(40);
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(12.5).fill(ACCENT).text(text, ML, doc.y);
  doc.moveDown(0.2);
  doc.fill('#000');
}
function para(text) {
  need(24);
  doc.font('Helvetica').fontSize(10.5).fill('#222').text(text, ML, doc.y, { width: CW, align: 'left', lineGap: 2 });
  doc.moveDown(0.5);
}
function steps(arr) {
  arr.forEach(function (s, i) {
    need(26);
    var x = ML, top = doc.y;
    doc.font('Helvetica-Bold').fontSize(10.5).fill(ACCENT).text((i + 1) + '.', x, top, { width: 20 });
    doc.font('Helvetica').fontSize(10.5).fill('#222').text(s, x + 22, top, { width: CW - 22, lineGap: 2 });
    doc.moveDown(0.35);
  });
  doc.moveDown(0.2);
}
function bullets(arr) {
  arr.forEach(function (s) {
    need(24);
    var top = doc.y;
    doc.font('Helvetica-Bold').fontSize(10.5).fill(ACCENT).text('•', ML, top, { width: 14 });
    doc.font('Helvetica').fontSize(10.5).fill('#222').text(s, ML + 16, top, { width: CW - 16, lineGap: 2 });
    doc.moveDown(0.35);
  });
  doc.moveDown(0.2);
}
function note(text) {
  var pad = 10;
  doc.font('Helvetica-Oblique').fontSize(10);
  var h = doc.heightOfString('Hinweis: ' + text, { width: CW - 2 * pad - 6, lineGap: 2 }) + 2 * pad;
  if (doc.y + h > BOTTOM) doc.addPage();
  var top = doc.y;
  doc.rect(ML, top, CW, h).fill('#fff7e6');
  doc.rect(ML, top, 4, h).fill(ACCENT);
  doc.fill('#5a4500').font('Helvetica-Oblique').fontSize(10).text('Hinweis: ' + text, ML + pad + 6, top + pad, { width: CW - 2 * pad - 6, lineGap: 2 });
  doc.y = top + h;
  doc.moveDown(0.6);
}

KAPITEL.forEach(function (k, i) {
  heading1((i + 1) + '. ' + k.t, i === 0);
  // Seitenzahl fuer das Kapitel im IV merken
  toc.filter(function (e) { return e.ref === k; }).forEach(function (e) { e.page = curPage; });
  (k.body || []).forEach(function (b) {
    if (b.h) { heading2(b.h); toc.filter(function (e) { return e.ref === b; }).forEach(function (e) { e.page = curPage; }); }
    else if (b.p) para(b.p);
    else if (b.steps) steps(b.steps);
    else if (b.bullets) bullets(b.bullets);
    else if (b.note) note(b.note);
  });
});

// Inhaltsverzeichnis nachtraeglich fuellen
var tIdx = tocStartIndex, ty;
doc.switchToPage(tIdx);
doc.font('Helvetica-Bold').fontSize(17).fill(DARK).text('Inhaltsverzeichnis', ML, MT);
ty = MT + 38;
toc.forEach(function (e) {
  if (ty + LH > BOTTOM) { tIdx++; doc.switchToPage(tIdx); ty = MT; }
  var indent = e.lvl === 2 ? 18 : 0;
  doc.font(e.lvl === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(e.lvl === 1 ? 11 : 10).fill(e.lvl === 1 ? DARK : '#444');
  doc.text(e.label, ML + indent, ty, { width: CW - indent - 34, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(10).fill(GREY).text(String(e.page), ML, ty, { width: CW, align: 'right' });
  ty += LH;
});

// Fusszeilen mit Seitenzahlen (ab Seite 2)
var total = curPage;
for (var pi = 0; pi < total; pi++) {
  doc.switchToPage(pi);
  if (pi === 0) continue; // Deckblatt ohne Fusszeile
  // Unteren Rand temporaer aufheben, damit das Schreiben in der Fusszeile KEINE neue Seite erzeugt
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(8.5).fill(LIGHT);
  doc.text('ReifenPro – Bedienungsanleitung', ML, PH - 42, { width: CW, align: 'left', lineBreak: false });
  doc.text('Seite ' + (pi + 1) + ' von ' + total, ML, PH - 42, { width: CW, align: 'right', lineBreak: false });
}

const endCount = doc.bufferedPageRange().count;
doc.flushPages();
doc.end();
console.log('PDF erzeugt:', ZIEL, '(' + total + ' Seiten geplant, ' + endCount + ' tatsächlich im Dokument)');
