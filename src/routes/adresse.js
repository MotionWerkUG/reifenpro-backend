'use strict';
// Adress-Vorschlag (PLZ -> Ort, Strassen-Autocomplete) fuer die oeffentliche
// Terminbuchung /termin/. Datensparsamer Proxy auf OpenPLZ (openplzapi.org):
// kostenlos, kein API-Key, amtliche DE-Daten. Wir loggen keine Eingaben und
// arbeiten fail-soft (ein Ausfall darf die Buchung NIE blockieren -> leere Liste).
const router = require('express').Router();
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({ windowMs: 60000, max: 60, message: { error: 'Zu viele Anfragen.' } });
const OPENPLZ = 'https://openplzapi.org/de';
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

// PLZ -> Ort(e). Nur bei vollstaendiger 5-stelliger PLZ.
router.get('/plz', limiter, async (req, res) => {
  const plz = String(req.query.plz || '').trim();
  if (!/^\d{5}$/.test(plz)) return res.json({ orte: [] });
  const rows = await hole(OPENPLZ + '/Localities?postalCode=' + encodeURIComponent(plz));
  const orte = [];
  rows.forEach(function (x) { if (x && x.name && orte.indexOf(x.name) === -1) orte.push(x.name); });
  res.json({ orte: orte.slice(0, 10) });
});

// Strassen-Vorschlaege (Fragment >= 3 Zeichen), optional auf eine PLZ eingegrenzt.
router.get('/strassen', limiter, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const plz = String(req.query.plz || '').trim();
  if (q.length < 3) return res.json({ strassen: [] });
  let url = OPENPLZ + '/Streets?name=' + encodeURIComponent(q);
  if (/^\d{5}$/.test(plz)) url += '&postalCode=' + encodeURIComponent(plz);
  const rows = await hole(url);
  const seen = {}, out = [];
  rows.forEach(function (x) {
    if (!x || !x.name) return;
    const key = x.name + '|' + (x.postalCode || '') + '|' + (x.locality || '');
    if (seen[key]) return;
    seen[key] = 1;
    out.push({ strasse: x.name, plz: x.postalCode || '', ort: x.locality || '' });
  });
  res.json({ strassen: out.slice(0, 8) });
});

module.exports = router;
