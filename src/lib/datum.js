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

// Nimmt 'YYYY-MM' (Monatsfeld) oder 'YYYY-MM-DD' (Datumsfeld) entgegen.
//
// Rueckgabe:
//   { ok: true,  wert: 'YYYY-MM-DD' | null }   null = nichts angegeben, das ist erlaubt
//   { ok: false, fehler: '<Satz fuer den Nutzer>' }
//
// Ein Monat ohne Tag wird auf den Monatsersten gelegt: So meint es, wer ein Monatsfeld ausfuellt.
// Der Aufrufer entscheidet, ob ein leerer Wert zulaessig ist -- hier ist er es.
function monatOderTag(wert) {
  if (wert == null || String(wert).trim() === '') return { ok: true, wert: null };
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

module.exports = { monatOderTag };
