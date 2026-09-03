// Widerrufsfrist: Muss der Kunde dem vorzeitigen Leistungsbeginn zustimmen?
//
// Warum als eigenes Modul: Die Frage wird an drei Stellen beantwortet -- im Formular der
// Buchungsstrecke, im Portal und auf dem Server. Als der Server sie selbst ausrechnete, lag er
// um einen Tag daneben: Er verglich Mitternacht (new Date().toDateString()) gegen 12 Uhr des
// Termintags, also eine halbe Tagesdifferenz, die Math.round nach oben zog. Ein Termin in 13
// Tagen ergab dort 14 und fiel damit aus der Frist -- waehrend das Formular korrekt fragte.
// Folge: Wer ohne Oberflaeche buchte, wurde am 13. Tag gar nicht gefragt, obwohl der Termin
// mitten in der Widerrufsfrist lag. Genau der Fall, den die Pruefung verhindern soll.
//
// Beide Seiten werden deshalb auf 12 Uhr gesetzt. Das ist auch gegen Sommerzeit robust: Ein
// Tageswechsel mit 23 oder 25 Stunden verschiebt eine Mittagsdifferenz nicht ueber die
// Rundungsgrenze, waehrend er es bei Mitternacht sehr wohl tut.

// Volle Tage zwischen heute und dem Termindatum ('YYYY-MM-DD'). Heute = 0.
function tageBisTermin(datumStr) {
  if (!datumStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(datumStr))) return null;
  const ziel = new Date(datumStr + 'T12:00:00');
  const heute = new Date();
  heute.setHours(12, 0, 0, 0);
  return Math.round((ziel - heute) / 86400000);
}

// Liegt der Termin innerhalb der 14-taegigen Widerrufsfrist, arbeiten wir vor deren Ablauf.
// Dafuer braucht es die ausdrueckliche Zustimmung des Verbrauchers (Paragraf 356 Abs. 4 BGB);
// ohne sie entfaellt bei einem Widerruf auch der Wertersatz (Paragraf 357a Abs. 2 BGB) und die
// geleistete Arbeit bliebe unbezahlt.
// Grenze: 13 Tage ja, 14 Tage nein. Bei spaeteren Terminen ist die Frage gegenstandslos und
// waere nur eine zusaetzliche Huerde.
function zustimmungNoetig(datumStr) {
  const t = tageBisTermin(datumStr);
  return t !== null && t < 14;
}

module.exports = { tageBisTermin, zustimmungNoetig };
