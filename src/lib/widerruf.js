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

// ── Telefonisch vereinbarte Termine ──────────────────────────────────────────────────────────
//
// Bei einer Online-Buchung fallen Vertragsschluss und Frage zusammen: Der Vertrag kommt in dem
// Moment zustande, in dem gebucht wird. Ab heute zu rechnen ist dort richtig.
//
// Beim Telefontermin nicht. Der Vertrag kommt am TELEFON zustande, der Betrieb legt den Termin
// danach an, und der Termin liegt noch spaeter. Die Widerrufsfrist endet 14 Tage nach dem
// VERTRAGSSCHLUSS -- wer ab heute rechnet, fragt bei Terminen, deren Frist laengst abgelaufen
// ist, und behauptet dabei einen Satz, der nicht stimmt ("Ihre Widerrufsfrist laeuft dann noch").
//
// Hinweis von portal-4e, die denselben Abstand in ihrem Verschiebe-Weg gefunden haben: Dort
// wird zu OFT gefragt, nie zu selten -- rechtlich unbedenklich, aber die Begruendung stimmt
// nicht. Hier ist der Abstand von Anfang an da, deshalb die eigene Rechnung.
//
// Beide Funktionen stehen bewusst nebeneinander statt eine zu aendern: tageBisTermin() wird von
// Buchungsstrecke und Portal benutzt, und zwei Sitzungen an derselben Fristrechnung war genau
// der Fehler, an dem die 13-Tage-Grenze auseinanderlief.

// Endet die Widerrufsfrist erst NACH dem Termin? Dann wird vor ihrem Ablauf gearbeitet und es
// braucht die ausdrueckliche Zustimmung (Paragraf 356 Abs. 4 BGB).
// vertragStr = Zeitpunkt des Vertragsschlusses ('YYYY-MM-DD' oder Date/Zeitstempel),
// terminStr  = Termindatum.
function zustimmungNoetigAbVertrag(vertragStr, terminStr) {
  if (!terminStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(terminStr).slice(0, 10))) return false;
  const vertrag = vertragStr ? new Date(String(vertragStr).slice(0, 10) + 'T12:00:00') : null;
  if (!vertrag || isNaN(vertrag)) return zustimmungNoetig(String(terminStr).slice(0, 10));
  // Fristende: 14 volle Tage nach Vertragsschluss.
  const fristende = new Date(vertrag.getTime() + 14 * 86400000);
  const termin = new Date(String(terminStr).slice(0, 10) + 'T12:00:00');
  return termin < fristende;
}

// Wann laeuft die Frist ab? Fuer die Anzeige im Admin und den Text der Bestaetigungsmail --
// "Ihre Frist laeuft bis zum ..." ist nachvollziehbar, "14 Tage" nicht.
function fristendeAbVertrag(vertragStr) {
  const vertrag = vertragStr ? new Date(String(vertragStr).slice(0, 10) + 'T12:00:00') : null;
  if (!vertrag || isNaN(vertrag)) return null;
  const ende = new Date(vertrag.getTime() + 14 * 86400000);
  return ende.getFullYear() + '-' + String(ende.getMonth() + 1).padStart(2, '0') + '-' + String(ende.getDate()).padStart(2, '0');
}

module.exports = { tageBisTermin, zustimmungNoetig, zustimmungNoetigAbVertrag, fristendeAbVertrag };
