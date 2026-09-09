// Datumseingaben aus Formularen annehmbar machen -- EINE Stelle fuer alle Felder.
//
// Warum es diese Datei gibt: Ein Monatsfeld (type="month") liefert 'YYYY-MM'. Ohne Tag lehnt
// Postgres das Einfuegen ab, und die Route antwortete mit einem Serverfehler. Gemessen am
// HU-Datum im Kundenportal: '2027-04' ergab HTTP 500, ebenso '2027-4' und beliebiger Text.
// Der Kunde erfaehrt daraus nichts und der Betrieb auch nicht.
//
// Zweiter, weniger offensichtlicher Fall: Eine reine Musterpruefung reicht NICHT. '2027-02-30'
// und '2027-13-01' passen auf 'YYYY-MM-DD', sind aber keine Kalendertage -- sie liefen weiter in
// die Datenbank und erzeugten denselben Serverfehler, nur fuer einen Vertipper statt fuer ein
// Monatsfeld. Deshalb hier ein echter Kalender-Rundlauf.
//
// Genutzt vom HU-Datum (Kundenportal) und von der Erstzulassung (Admin). Zwei Normalisierungen,
// die auseinanderlaufen, sind genau die Fehlerquelle, an der in diesem Projekt schon die
// Gutscheinrechnung, die Oeffnungszeiten und die Widerrufsfrist auseinandergelaufen sind.

// Ein Date-Objekt in den KALENDERTAG umrechnen, den es in Deutschland bezeichnet.
//
// Warum nicht toISOString(): Ein Date ist ein Zeitpunkt, kein Kalendertag. 00:30 Uhr Berliner
// Zeit ist in UTC noch der Vortag -- toISOString() macht aus dem 10. August den 9. Genau diese
// Verwechslung hat in der Admin-Sitzung eine Fristrechnung um einen Tag verschoben.
// Ein ungueltiges Date gibt null zurueck; der Aufrufer entscheidet, was das bedeutet.
function alsTag(wert) {
  if (!(wert instanceof Date) || isNaN(wert.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(wert);
}

// Nimmt 'YYYY-MM' (Monatsfeld), 'YYYY-MM-DD' (Datumsfeld) oder ein Date entgegen.
//
// Rueckgabe:
//   { ok: true,  wert: 'YYYY-MM-DD' | null }   null = nichts angegeben, das ist erlaubt
//   { ok: false, fehler: '<Satz fuer den Nutzer>' }
//
// Ein Monat ohne Tag wird auf den Monatsersten gelegt: So meint es, wer ein Monatsfeld ausfuellt.
// Der Aufrufer entscheidet, ob ein leerer Wert zulaessig ist -- hier ist er es.
function monatOderTag(wert) {
  if (wert == null || String(wert).trim() === '') return { ok: true, wert: null };
  // Ein Date-Objekt kommt aus dem Datenbanktreiber (z. B. termine.erstellt_am). Ausdruecklich
  // annehmen, aber ueber die Zeitzone umrechnen -- nicht ueber toISOString().
  if (wert instanceof Date) {
    const tag = alsTag(wert);
    // Ein ungueltiges Date ist ein Programmierfehler und muss sichtbar bleiben. Ein stiller
    // Rueckfall saehe wie eine Absicherung aus, macht aus dem Fehler aber ein falsches Ergebnis.
    return tag ? { ok: true, wert: tag } : { ok: false, fehler: 'Das übergebene Datum ist ungültig.' };
  }
  const v = String(wert).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    // Form allein genuegt nicht: Der Tag muss auch existiert haben. Rundlauf ueber Date --
    // nur wenn Jahr, Monat und Tag unveraendert zurueckkommen, gab es diesen Tag wirklich.
    const teile = v.split('-').map(Number);
    const d = new Date(Date.UTC(teile[0], teile[1] - 1, teile[2]));
    if (d.getUTCFullYear() === teile[0] && d.getUTCMonth() === teile[1] - 1 && d.getUTCDate() === teile[2]) {
      return { ok: true, wert: v };
    }
    return { ok: false, fehler: 'Dieses Datum gibt es nicht. Bitte prüfen Sie Tag und Monat.' };
  }

  const m = v.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const monat = parseInt(m[2], 10);
    if (monat >= 1 && monat <= 12) {
      return { ok: true, wert: m[1] + '-' + String(monat).padStart(2, '0') + '-01' };
    }
    return { ok: false, fehler: 'Dieses Datum gibt es nicht. Bitte prüfen Sie Tag und Monat.' };
  }

  return { ok: false, fehler: 'Bitte geben Sie Monat und Jahr an (zum Beispiel 04/2027).' };
}


// ── Erstzulassung ────────────────────────────────────────────────────────────────────────────
//
// Die Erstzulassung ist die massgebliche Angabe im Fahrzeugschein; an ihr haengt die HU. Das
// BAUJAHR ist etwas anderes und interessiert den Betrieb nicht -- ein Fahrzeug kann im Dezember
// gebaut und im Maerz zugelassen worden sein. Entscheidung des Inhabers vom 09.09.2026: Erfasst
// wird immer die Erstzulassung, das Baujahr faellt weg.
//
// Der Kunde weiss sie oft nur ungenau -- am Telefon haeufig nur das Jahr. Das ist ausdruecklich
// erlaubt. Damit die Anzeige dann aber keinen Monat erfindet, den nie jemand erfasst hat, wird
// die GENAUIGKEIT mitgeliefert und gehoert neben das Datum in die Datenbank:
//
//   '2019'         -> { wert: '2019-01-01', genauigkeit: 'jahr'  }  angezeigt als "2019"
//   '2019-04'      -> { wert: '2019-04-01', genauigkeit: 'monat' }  angezeigt als "04/2019"
//   '2019-04-15'   -> { wert: '2019-04-15', genauigkeit: 'tag'   }  angezeigt als "15.04.2019"
//
// Der 1. Januar bei 'jahr' ist ein Platzhalter zum Rechnen und Sortieren, KEINE Aussage. Ohne
// die Genauigkeit danebenzuschreiben, stuende er spaeter auf einer Erinnerung, als haette ihn
// jemand erfasst.
//
// Fuer das HU-Datum gilt das NICHT -- dort ist monatOderTag richtig: Eine Hauptuntersuchung ist
// auf einen Monat faellig, ein blosses Jahr waere dort keine brauchbare Angabe.
function erstzulassungPruefen(wert) {
  if (wert == null || String(wert).trim() === '') return { ok: true, wert: null, genauigkeit: null };
  const v = String(wert).trim();

  const nurJahr = v.match(/^(\d{4})$/);
  if (nurJahr) {
    const j = parseInt(nurJahr[1], 10);
    // Untergrenze bewusst grosszuegig (Oldtimer), Obergrenze: das naechste Jahr, weil Fahrzeuge
    // im Dezember schon fuer das Folgejahr zugelassen werden.
    if (j < 1900 || j > new Date().getFullYear() + 1) {
      return { ok: false, fehler: 'Dieses Jahr kann nicht stimmen. Bitte prüfen Sie die Angabe.' };
    }
    return { ok: true, wert: nurJahr[1] + '-01-01', genauigkeit: 'jahr' };
  }

  const p = monatOderTag(v);
  if (!p.ok) {
    // Die Meldung von monatOderTag nennt nur Monat und Jahr. Hier ist auch ein blosses Jahr
    // erlaubt, also muss die Meldung das sagen -- sonst probiert der Nutzer das Falsche.
    return /gibt es nicht/.test(p.fehler)
      ? { ok: false, fehler: p.fehler }
      : { ok: false, fehler: 'Bitte geben Sie mindestens das Jahr an (zum Beispiel 2019 oder 04/2019).' };
  }
  return { ok: true, wert: p.wert, genauigkeit: /^\d{4}-\d{1,2}$/.test(v) ? 'monat' : 'tag' };
}

// Wie die Erstzulassung angezeigt wird -- an EINER Stelle, damit Admin, Portal, Rechnung und
// Erinnerung dasselbe schreiben.
function erstzulassungText(datum, genauigkeit) {
  if (!datum) return '';
  const t = String(datum).slice(0, 10);
  const j = t.slice(0, 4), m = t.slice(5, 7), d = t.slice(8, 10);
  if (genauigkeit === 'jahr') return j;
  if (genauigkeit === 'monat') return m + '/' + j;
  return d + '.' + m + '.' + j;
}

module.exports = { monatOderTag, alsTag, erstzulassungPruefen, erstzulassungText };
