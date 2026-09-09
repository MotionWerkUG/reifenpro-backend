// Wie ein Nachlass BESCHRIFTET wird -- an EINER Stelle fuer Portal und Rechnung.
//
// Warum es diese Datei gibt: Am 09.09.2026 zeigte das Kundenportal fuer denselben Termin
// "Gutschein WINTER2026 (-25 %)", waehrend die Rechnung "Nachlass Reifeneinlagerung (25 %) -
// Gutschein WINTER2026" auswies. Betrag und Satz stimmten ueberein, der Wortlaut nicht -- und die
// Rechnung benennt zusaetzlich die betroffene Leistung, wenn es nur eine ist. Der Kunde legt
// beides nebeneinander und muss dieselbe Zeile wiedererkennen.
//
// Das ist in diesem Projekt kein neues Muster: Gutscheinrechnung, Oeffnungszeiten und
// Widerrufsfrist sind schon einmal auseinandergelaufen, weil zwei Stellen dasselbe rechneten.
// Deshalb hier die REGEL statt einer zweiten Fassung davon.
//
// Vorbild und Wortlaut stammen aus nachlassPositionen() in src/routes/rechnungen.js. Die Rechnung
// ist der massgebliche Beleg; das Portal folgt ihr, nicht umgekehrt. rechnungen.js kann diese
// Funktion uebernehmen -- sie versteht dessen Positionsform ausdruecklich mit (siehe basisVon).

const { round2 } = require('./gutschein');

// Bruttobetrag einer Position ermitteln -- die beiden Wege benennen ihn verschieden:
//   Termin   (leistungen[]):        zeilen_brutto            -- der eingefrorene Zeilenbetrag
//   Rechnung (rechnung_positionen): menge x einzelpreis_*    -- brutto oder netto
// Der Rueckgabewert sagt auch, WELCHE Basis es war: Brutto- und Nettozeilen duerfen nicht in
// dieselbe Gruppe fallen, sonst wuerde ein Nachlass ueber zwei verschiedene Bezugsgroessen
// gerechnet.
function basisVon(p) {
  if (p.zeilen_brutto != null) {
    return { wert: round2(Number(p.zeilen_brutto) || 0), brutto: true };
  }
  const menge = Number(p.menge) || 0;
  if (p.einzelpreis_brutto != null) {
    return { wert: round2(menge * (Number(p.einzelpreis_brutto) || 0)), brutto: true };
  }
  if (p.einzelpreis_netto != null) {
    return { wert: round2(menge * (Number(p.einzelpreis_netto) || 0)), brutto: false };
  }
  return { wert: 0, brutto: true };
}

// Liefert je Rabattsatz EINE Zeile:
//   { satz, betrag, bezeichnung, brutto }
//
// betrag ist POSITIV (der abzuziehende Wert). Wer Minuszeilen braucht -- die Rechnung -- dreht
// das Vorzeichen selbst; die Anzeige im Portal setzt ein eigenes Minuszeichen davor.
//
// herkunft ist der Satzteil hinter dem Gedankenstrich ("Gutschein WINTER2026",
// "Vereinbarter Nachlass") oder null, wenn sie unbekannt ist. Sie wird NICHT erraten.
//
// Rechenregeln, wie im Projekt festgelegt (siehe gutschein.js):
//   - gerechnet wird auf den BRUTTO-Preis (25 % von 40,00 sind 10,00 -- so steht es auf dem Flyer)
//   - gerundet wird EINMAL je Gruppe, nicht je Zeile
//   - gruppiert wird nach Rabattsatz UND Steuersatz (heute alles 19 %, muss aber mehrere aushalten)
function nachlassZeilen(positionen, herkunft) {
  const gruppen = new Map();
  (positionen || []).forEach(function (p) {
    const satz = Number(p.rabatt_prozent);
    if (!Number.isFinite(satz) || satz <= 0) return;
    const b = basisVon(p);
    if (b.wert <= 0) return;
    const mwst = Number.isFinite(Number(p.mwst_satz)) ? Number(p.mwst_satz) : 19;
    const key = satz + '|' + mwst + '|' + (b.brutto ? 'b' : 'n');
    const g = gruppen.get(key) || { satz: satz, mwst: mwst, brutto: b.brutto, basis: 0, namen: [] };
    g.basis = round2(g.basis + b.wert);
    g.namen.push(String(p.bezeichnung || '').trim());
    gruppen.set(key, g);
  });

  return Array.from(gruppen.values()).map(function (g) {
    // Betrifft ein Satz genau EINE Leistung, wird sie benannt -- der Kunde soll sehen, worauf sich
    // der Abzug bezieht. Bei mehreren waere eine Aufzaehlung unlesbar, deshalb zusammengefasst.
    const was = g.namen.length === 1 && g.namen[0] ? g.namen[0] : 'übrige Leistungen';
    return {
      satz: g.satz,
      mwst_satz: g.mwst,
      brutto: g.brutto,
      betrag: round2(g.basis * g.satz / 100),
      bezeichnung: 'Nachlass ' + was + ' (' + g.satz + ' %)' + (herkunft ? ' — ' + herkunft : '')
    };
  }).sort(function (a, b) { return b.satz - a.satz; });
  // Absteigend nach Satz: Der groesste Nachlass steht oben, so wie es das Portal bisher zeigte.
  // rechnungen.js sortiert heute nicht (Einfuegereihenfolge). Wer die Funktion dort uebernimmt,
  // aendert damit die Reihenfolge der Nachlasszeilen auf dem Beleg -- Betraege und Summe bleiben
  // gleich, aber es ist eine sichtbare Aenderung und gehoert bewusst entschieden.
}

// Summe aller Nachlasszeilen -- damit niemand sie am Aufrufort erneut zusammenzaehlt und dabei
// anders rundet.
function nachlassSumme(zeilen) {
  return round2((zeilen || []).reduce(function (s, z) { return s + (Number(z.betrag) || 0); }, 0));
}

module.exports = { nachlassZeilen, nachlassSumme };
