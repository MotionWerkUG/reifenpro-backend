'use strict';
// Deutsche gesetzliche Feiertage je Bundesland — komplett im Code berechnet (keine externe API).
// Bewegliche Feiertage haengen an Ostersonntag (Gaussche Osterformel, gregorianisch).
// Quelle Matrix: gesetzliche Feiertage der Laender (Stand 2026). Gemeindeabhaengige Faelle
// (Mariae Himmelfahrt in BY) sind als optionale Vorschlaege getrennt gefuehrt.

const LAENDER = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg',
  HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz',
  SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein',
  TH: 'Thüringen'
};

// Ostersonntag (gregorianisch) nach der Gaussschen Osterformel.
function ostersonntag(jahr) {
  const a = jahr % 19;
  const b = jahr % 4;
  const c = jahr % 7;
  const k = Math.floor(jahr / 100);
  const p = Math.floor((13 + 8 * k) / 25);
  const q = Math.floor(k / 4);
  const M = (15 - p + k - q) % 30;
  const N = (4 + k - q) % 7;
  const d = (19 * a + M) % 30;
  const e = (2 * b + 4 * c + 6 * d + N) % 7;
  let tag = 22 + d + e;
  let monat = 3;
  if (tag > 31) { tag -= 31; monat = 4; }
  if (monat === 4 && tag === 26) tag = 19;
  if (monat === 4 && tag === 25 && d === 28 && e === 6 && a > 10) tag = 18;
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

function iso(dtUtc) {
  return dtUtc.getUTCFullYear() + '-' +
    String(dtUtc.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(dtUtc.getUTCDate()).padStart(2, '0');
}
function fix(jahr, monat, tag) { return iso(new Date(Date.UTC(jahr, monat - 1, tag))); }
function ostersonntagPlus(jahr, offsetTage) {
  const o = ostersonntag(jahr);
  return iso(new Date(o.getTime() + offsetTage * 86400000));
}
// Bussss- und Bettag: Mittwoch vor dem 23. November.
function bussUndBettag(jahr) {
  const d = new Date(Date.UTC(jahr, 10, 23)); // 23. Nov
  // zurueck bis zum Mittwoch (getUTCDay(): So=0 ... Mi=3), mindestens einen Tag zurueck
  let delta = (d.getUTCDay() - 3 + 7) % 7;
  if (delta === 0) delta = 7;
  return iso(new Date(d.getTime() - delta * 86400000));
}

// Baut die Feiertagsliste eines Jahres fuer ein Bundesland (Kuerzel, z.B. 'BY').
// Rueckgabe: [{ datum:'YYYY-MM-DD', name, bundesweit:boolean }] chronologisch sortiert.
function feiertage(bundesland, jahr) {
  const bl = String(bundesland || '').toUpperCase();
  const list = [];
  const add = (datum, name, bundesweit) => list.push({ datum, name, bundesweit: !!bundesweit });
  const inBL = (arr) => arr.indexOf(bl) !== -1;

  // Bundesweit (alle 16 Laender)
  add(fix(jahr, 1, 1), 'Neujahr', true);
  add(ostersonntagPlus(jahr, -2), 'Karfreitag', true);
  add(ostersonntagPlus(jahr, 1), 'Ostermontag', true);
  add(fix(jahr, 5, 1), 'Tag der Arbeit', true);
  add(ostersonntagPlus(jahr, 39), 'Christi Himmelfahrt', true);
  add(ostersonntagPlus(jahr, 50), 'Pfingstmontag', true);
  add(fix(jahr, 10, 3), 'Tag der Deutschen Einheit', true);
  add(fix(jahr, 12, 25), '1. Weihnachtsfeiertag', true);
  add(fix(jahr, 12, 26), '2. Weihnachtsfeiertag', true);

  // Regional
  if (inBL(['BW', 'BY', 'ST'])) add(fix(jahr, 1, 6), 'Heilige Drei Könige', false);
  if (inBL(['BE', 'MV'])) add(fix(jahr, 3, 8), 'Internationaler Frauentag', false);
  if (inBL(['BW', 'BY', 'HE', 'NW', 'RP', 'SL'])) add(ostersonntagPlus(jahr, 60), 'Fronleichnam', false);
  if (inBL(['SL'])) add(fix(jahr, 8, 15), 'Mariä Himmelfahrt', false);
  if (inBL(['TH'])) add(fix(jahr, 9, 20), 'Weltkindertag', false);
  if (inBL(['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'])) add(fix(jahr, 10, 31), 'Reformationstag', false);
  if (inBL(['BW', 'BY', 'NW', 'RP', 'SL'])) add(fix(jahr, 11, 1), 'Allerheiligen', false);
  if (inBL(['SN'])) add(bussUndBettag(jahr), 'Buß- und Bettag', false);

  list.sort((a, b) => a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0);
  return list;
}

// Gemeindeabhaengige/optionale Vorschlaege (nicht ueberall gesetzlich frei) — getrennt, damit sie
// nicht automatisch als "geschlossen" gesetzt werden, sondern als abschaltbarer Vorschlag erscheinen.
function optionaleTage(bundesland, jahr) {
  const bl = String(bundesland || '').toUpperCase();
  const list = [];
  if (bl === 'BY') list.push({ datum: fix(jahr, 8, 15), name: 'Mariä Himmelfahrt (nur kath. Gemeinden)', bundesweit: false });
  // Heiligabend/Silvester sind keine gesetzlichen Feiertage, aber oft (verkuerzt) geschlossen.
  list.push({ datum: fix(jahr, 12, 24), name: 'Heiligabend', bundesweit: false });
  list.push({ datum: fix(jahr, 12, 31), name: 'Silvester', bundesweit: false });
  return list;
}

module.exports = { feiertage, optionaleTage, ostersonntag, bussUndBettag, LAENDER };
