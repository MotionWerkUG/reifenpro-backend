'use strict';
// Adress-Vorschlag (PLZ -> Ort, Strassen-Autocomplete) fuer Terminbuchung und
// Kundenportal. Datensparsamer Proxy: Der Server fragt an, nicht der Browser des
// Kunden — dadurch erfaehrt kein fremder Dienst die IP-Adresse des Besuchers.
// Wir loggen keine Eingaben und arbeiten fail-soft (ein Ausfall darf die Buchung
// NIE blockieren -> leere Liste).
//
// ZWEI QUELLEN, bewusst in dieser Reihenfolge:
//  1. Photon (photon.komoot.io, OpenStreetMap-Daten, kostenlos, ohne Schluessel).
//     Kennt HAUSNUMMERN, verzeiht Tippfehler und findet beide Schreibweisen.
//  2. OpenPLZ (openplzapi.org, amtliche Daten) als Rueckfallebene und fuer PLZ -> Ort.
// Warum ueberhaupt zwei: OpenPLZ speichert Strassen ABGEKUERZT ("Stöhrerstr.") und
// sucht nach enthaltener Zeichenfolge. Wer "Stöhrerstraße" ausschreibt, findet damit
// nichts — und Hausnummern kennt der Dienst gar nicht.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({ windowMs: 60000, max: 60, message: { error: 'Zu viele Anfragen.' } });
const OPENPLZ = 'https://openplzapi.org/de';
const PHOTON  = 'https://photon.komoot.io/api';
const UA = 'ReifenPro/1.0 (+https://www.schroeder-scholz.de)';

async function hole(url) {
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, 5000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Photon liefert GeoJSON, nicht ein Array — daher eine eigene Abfrage.
// Gefiltert wird hier: Nur Eintraege mit Strassenname und deutscher Postleitzahl
// kommen durch, sonst landen Laeden, Haltestellen und auslaendische Orte in der Liste.
async function holePhoton(q, plz) {
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, 5000);
  try {
    let url = PHOTON + '?q=' + encodeURIComponent(q) + '&limit=8&lang=de';
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return [];
    const j = await r.json();
    const feats = (j && Array.isArray(j.features)) ? j.features : [];
    return feats.map(function (f) {
      const p = (f && f.properties) || {};
      return { strasse: p.street || p.name || '', hausnr: p.housenumber || '', plz: p.postcode || '', ort: p.city || p.town || p.village || p.county || '' };
    }).filter(function (a) {
      if (!a.strasse) return false;
      if (a.plz && !/^\d{5}$/.test(a.plz)) return false;      // nur deutsche Postleitzahlen
      if (plz && a.plz && a.plz !== plz) return false;         // auf die eingegebene PLZ eingrenzen
      return true;
    });
  } catch (e) {
    return [];
  } finally {
    clearTimeout(t);
  }
}

// PLZ -> Ort(e). Nur bei vollstaendiger 5-stelliger PLZ.
router.get('/plz', limiter, async (req, res) => {
  const plz = String(req.query.plz || '').trim();
  if (!/^\d{5}$/.test(plz)) return res.json({ orte: [] });
  const rows = await hole(OPENPLZ + '/Localities?postalCode=' + encodeURIComponent(plz));
  const orte = [];
  rows.forEach(function (x) { if (x && x.name && orte.indexOf(x.name) === -1) orte.push(x.name); });
  res.json({ orte: orte.slice(0, 10) });
});

// Amtliche Strassennamen sind bei OpenPLZ abgekuerzt gespeichert ("Stöhrerstr.") und
// werden als enthaltene Zeichenfolge gesucht. Wer ausschreibt, findet dort nichts.
// Fuer die Rueckfallebene wird deshalb zusaetzlich die abgekuerzte Schreibweise probiert.
function schreibweisen(q) {
  const varianten = [q];
  const abgekuerzt = q.replace(/stra(ß|ss)e\b/gi, 'str.').replace(/stra(ß|ss)e$/i, 'str.');
  if (abgekuerzt !== q) varianten.push(abgekuerzt);
  const ausgeschrieben = q.replace(/str\.?\b/gi, 'straße');
  if (ausgeschrieben !== q && varianten.indexOf(ausgeschrieben) === -1) varianten.push(ausgeschrieben);
  return varianten.slice(0, 3);
}

// Strassen-Vorschlaege (Fragment >= 3 Zeichen), optional auf eine PLZ eingegrenzt.
// Antwort je Treffer: { strasse, hausnr, plz, ort }. `hausnr` ist neu und kann leer sein —
// aeltere Oberflaechen ignorieren das Feld und haengen weiter die getippte Nummer an.
router.get('/strassen', limiter, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const plz = String(req.query.plz || '').trim();
  if (q.length < 3) return res.json({ strassen: [] });

  // 1. Photon: kennt Hausnummern, verzeiht Tippfehler, findet beide Schreibweisen.
  // Die Postleitzahl wird an die Suche angehaengt statt gefiltert — das schaerft die
  // Treffer, ohne einen Ort auszuschliessen, dessen PLZ Photon nicht mitliefert.
  let out = await holePhoton(plz ? (q + ' ' + plz) : q, /^\d{5}$/.test(plz) ? plz : '');

  // 2. Rueckfallebene: amtliche Daten. Greift, wenn Photon nichts liefert oder ausfaellt —
  // die Adresseingabe darf nie leer bleiben, nur weil ein fremder Dienst hakt.
  if (!out.length) {
    const rows = [];
    for (const variante of schreibweisen(q)) {
      let url = OPENPLZ + '/Streets?name=' + encodeURIComponent(variante);
      if (/^\d{5}$/.test(plz)) url += '&postalCode=' + encodeURIComponent(plz);
      const teil = await hole(url);
      rows.push.apply(rows, teil);
      if (rows.length >= 8) break;
    }
    out = rows.map(function (x) {
      return { strasse: (x && x.name) || '', hausnr: '', plz: (x && x.postalCode) || '', ort: (x && x.locality) || '' };
    }).filter(function (a) { return !!a.strasse; });
  }

  const seen = {}, liste = [];
  out.forEach(function (a) {
    const key = a.strasse + '|' + a.hausnr + '|' + a.plz + '|' + a.ort;
    if (seen[key]) return;
    seen[key] = 1;
    liste.push(a);
  });
  res.json({ strassen: liste.slice(0, 8) });
});

module.exports = router;
