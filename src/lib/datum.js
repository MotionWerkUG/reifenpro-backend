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

module.exports = { monatOderTag, alsTag };
