// Vereinbarte Kundenkonditionen (Gewerbekunden) fuer die Preisberechnung im Portal.
//
// Warum es diese Datei gibt: Die Konditionen wurden bisher NUR beim Erzeugen der Rechnung
// aufgeloest. Ein angemeldeter Gewerbekunde sah beim Buchen den Listenpreis und bekam erst
// hinterher einen anderen Betrag auf dem Beleg. Gemessen wurde das an einem Kunden mit 20 %
// Pauschalrabatt: online gebucht 39,00, im Admin von Hand angelegt 31,20. Sobald der Termin
// eine Positionsliste hat, kommen die Betraege aus den gebuchten Zeilen -- die Konditionen
// wurden dann gar nicht mehr angefasst.
//
// Der Schnitt ist derselbe wie beim Gutschein: aufloesen, wo der Kunde hinsieht, und in
// zeilen_brutto einfrieren. Dann KANN die Rechnung nicht abweichen, statt dass zwei Rechenwege
// synchron gehalten werden muessen.
//
// Zwei Arten von Konditionen, die auf dem Beleg verschieden behandelt werden muessen:
//   kunden_preise         Ein FESTER Preis. Er IST der Preis und gehoert als Positionspreis
//                         ausgewiesen -- KEINE Nachlasszeile.
//   grosskunden_rabatt    Eine vereinbarte Entgeltminderung. Sie gehoert nach
//                         § 14 Abs. 4 Nr. 7 UStG als Nachlass auf den Beleg und laeuft
//                         deshalb ueber rabatt_prozent je Position, genau wie der Gutschein.
//
// Gutschein und Konditionen schliessen sich AUS (Entscheidung des Inhabers): Es gilt der fuer
// den Kunden guenstigere Satz, gestapelt wird nicht.

const { query } = require('../db/index');
const { round2 } = require('./gutschein');

// Konditionen eines Kunden einmal laden. Ohne Kunden-ID (Gastbuchung) gibt es keine --
// das ist richtig so und kein Fehler: Konditionen haengen am Konto.
async function ladeKonditionen(kundenId) {
  const leer = { rabatt_prozent: 0, preise: {} };
  if (!kundenId) return leer;
  const k = (await query('SELECT ist_gewerbe, grosskunden_rabatt FROM kunden WHERE id=$1', [kundenId])).rows[0];
  if (!k) return leer;
  const preise = {};
  const rows = (await query('SELECT artikel_id, preis FROM kunden_preise WHERE kunden_id=$1', [kundenId])).rows;
  rows.forEach(function (r) { preise[r.artikel_id] = Number(r.preis); });
  // Der Pauschalrabatt gilt unabhaengig von ist_gewerbe, wenn er gepflegt ist -- die Kennung
  // steuert im Admin die Sichtbarkeit, nicht die Gueltigkeit einer eingetragenen Vereinbarung.
  let satz = Number(k.grosskunden_rabatt) || 0;
  if (satz < 0) satz = 0;
  if (satz > 100) satz = 100;
  return { rabatt_prozent: satz, preise: preise };
}

// Entscheidet fuer EINE Position, welcher Preis gilt.
//
// listenBrutto  der regulaere Bruttopreis (inkl. Zoll-/Fahrzeugstaffel)
// gutscheinSatz Prozentsatz aus dem eingegebenen Gutschein (0, wenn keiner gilt)
//
// Rueckgabe:
//   brutto          Preis, der als zeilen_brutto eingefroren wird
//   rabatt_prozent  Satz fuer die Nachlasszeile (0 bei festem Kundenpreis)
//   quelle          'liste' | 'kundenpreis' | 'konditionen' | 'gutschein'
//   verworfen       welcher Vorteil nicht angewandt wurde ('gutschein'|'konditionen'|null)
//
// Verglichen wird immer der ENDPREIS, nicht der Prozentsatz -- bei einem festen Kundenpreis
// gibt es gar keinen Satz, den man vergleichen koennte.
function preisFuer(kond, artikelId, listenBrutto, gutscheinSatz) {
  const liste = round2(Number(listenBrutto) || 0);
  const gSatz = Math.max(0, Math.min(100, Number(gutscheinSatz) || 0));
  const kSatz = Math.max(0, Math.min(100, Number(kond && kond.rabatt_prozent) || 0));
  const fest = kond && kond.preise && kond.preise[artikelId] != null ? round2(kond.preise[artikelId]) : null;

  const kandidaten = [{ end: liste, quelle: 'liste', satz: 0 }];
  if (fest !== null) kandidaten.push({ end: fest, quelle: 'kundenpreis', satz: 0 });
  if (kSatz > 0) kandidaten.push({ end: round2(liste * (1 - kSatz / 100)), quelle: 'konditionen', satz: kSatz });
  if (gSatz > 0) kandidaten.push({ end: round2(liste * (1 - gSatz / 100)), quelle: 'gutschein', satz: gSatz });

  // Guenstigster Endpreis gewinnt. Bei Gleichstand gewinnt die vereinbarte Kondition vor dem
  // Gutschein: Sie ist dauerhaft zugesagt, waehrend der Gutschein eine Aktion ist -- und der
  // Kunde soll seinen Gutschein dann noch fuer etwas anderes verwenden koennen.
  const rang = { kundenpreis: 0, konditionen: 1, gutschein: 2, liste: 3 };
  kandidaten.sort(function (a, b) { return a.end - b.end || rang[a.quelle] - rang[b.quelle]; });
  const sieger = kandidaten[0];

  let verworfen = null;
  if (sieger.quelle !== 'gutschein' && gSatz > 0) verworfen = 'gutschein';
  else if (sieger.quelle === 'gutschein' && (kSatz > 0 || fest !== null)) verworfen = 'konditionen';

  return {
    // Fester Kundenpreis ersetzt den Positionspreis; die Rabattarten lassen ihn stehen und
    // wirken ueber die Nachlasszeile, damit der Steuerausweis stimmt.
    brutto: sieger.quelle === 'kundenpreis' ? sieger.end : liste,
    listen_brutto: liste,
    rabatt_prozent: sieger.satz,
    quelle: sieger.quelle,
    verworfen: verworfen
  };
}

module.exports = { ladeKonditionen, preisFuer };
