'use strict';
// Lesemodell fuer Oeffnungszeiten: besondere Tage (Feiertag/Urlaub) ueberschreiben die regulaere Woche.
// Ersetzt die frueheren Einzelfeld-Abfragen (mo_fr_*, sa_*, so_*, mittagspause_*) in Homepage/Portal/Gast.
const { query } = require('../db/index');

// JS getDay(): So=0..Sa=6  ->  intern Mo=0..So=6
function internerWochentag(jsDay) { return (jsDay + 6) % 7; }

// 'YYYY-MM-DD' -> lokaler Wochentag (Zeitzonenbug vermeiden: T12:00:00 anhaengen)
function wochentagAusDatum(datumStr) {
  return internerWochentag(new Date(datumStr + 'T12:00:00').getDay());
}

// Liefert { geschlossen:boolean, spannen:[[von,bis],...] } fuer ein Datum 'YYYY-MM-DD'.
// von/bis sind 'HH:MM'-Strings (auf Minuten gekuerzt).
async function oeffnungFuerTag(datumStr) {
  const kurz = (t) => t ? String(t).slice(0, 5) : null;
  // 1. Besonderer Tag? (ueberschreibt die Woche)
  const bt = (await query('SELECT geschlossen, von, bis FROM besondere_tage WHERE datum=$1', [datumStr])).rows[0];
  if (bt) {
    if (bt.geschlossen) return { geschlossen: true, spannen: [] };
    if (bt.von && bt.bis) return { geschlossen: false, spannen: [[kurz(bt.von), kurz(bt.bis)]] };
    // nicht geschlossen, aber ohne eigene Zeiten -> regulaere Zeiten gelten (unten weiter)
  }
  // 2. Regulaerer Wochentag
  const wt = wochentagAusDatum(datumStr);
  const row = (await query('SELECT geschlossen, von1, bis1, von2, bis2 FROM oeffnungszeiten WHERE wochentag=$1', [wt])).rows[0];
  if (!row || row.geschlossen) return { geschlossen: true, spannen: [] };
  const spannen = [];
  if (row.von1 && row.bis1) spannen.push([kurz(row.von1), kurz(row.bis1)]);
  if (row.von2 && row.bis2) spannen.push([kurz(row.von2), kurz(row.bis2)]);
  return { geschlossen: spannen.length === 0, spannen };
}

// Ganze Woche (fuer Homepage-Anzeige/schema.org): Array[0..6] = { geschlossen, spannen }.
async function regulaereWoche() {
  const rows = (await query('SELECT wochentag, geschlossen, von1, bis1, von2, bis2 FROM oeffnungszeiten')).rows;
  const kurz = (t) => t ? String(t).slice(0, 5) : null;
  const woche = [];
  for (let wt = 0; wt < 7; wt++) {
    const row = rows.find((r) => r.wochentag === wt);
    if (!row || row.geschlossen) { woche.push({ geschlossen: true, spannen: [] }); continue; }
    const spannen = [];
    if (row.von1 && row.bis1) spannen.push([kurz(row.von1), kurz(row.bis1)]);
    if (row.von2 && row.bis2) spannen.push([kurz(row.von2), kurz(row.bis2)]);
    woche.push({ geschlossen: spannen.length === 0, spannen });
  }
  return woche;
}

module.exports = { oeffnungFuerTag, regulaereWoche, wochentagAusDatum, internerWochentag };
