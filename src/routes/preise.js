'use strict';
// Oeffentliche Preisuebersicht (read-only) fuer die statische Seite /preise/.
// Zeigt genau die buchbaren, aktiven Leistungen (identisch zur Terminbuchung, damit
// Preisseite und Buchung nie auseinanderlaufen). Preise als BRUTTO (inkl. MwSt) wenn
// einstellungen.preise_inkl_mwst gesetzt ist (PAngV: Verbraucher sehen Bruttoendpreise).
// "ab"-Preis = niedrigster zutreffender Wert (Basis bzw. guenstigste Staffel-Variante).
// Fail-soft und ohne Login; keine personenbezogenen Daten.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { query } = require('../db/index');

const limiter = rateLimit({ windowMs: 60000, max: 60, message: { error: 'Zu viele Anfragen.' } });
const round2 = function (n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; };

router.get('/', limiter, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT bl.artikel_id, bl.rolle, COALESCE(NULLIF(bl.titel,''), a.name) AS titel,
              bl.beschreibung, bl.sortierung, a.dauer_minuten, a.einheit, a.preis, a.mwst_satz
       FROM buchung_leistungen bl JOIN artikel a ON a.id = bl.artikel_id
       WHERE bl.aktiv = true AND a.aktiv IS NOT false
       ORDER BY bl.sortierung, titel`);

    const ids = rows.map(function (r) { return r.artikel_id; });
    const vars = ids.length ? (await query(
      `SELECT artikel_id, fahrzeug_typ, zoll_min, zoll_max, preis, mwst_satz
         FROM artikel_preise WHERE artikel_id = ANY($1::uuid[]) ORDER BY preis`, [ids])).rows : [];
    const inkl = (((await query('SELECT preise_inkl_mwst FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {}).preise_inkl_mwst) !== false;

    // Rohpreis -> Brutto: bei inkl bereits Brutto, sonst mit (1 + satz/100) hochrechnen.
    const toBrutto = function (preis, satz) {
      const f = 1 + Number(satz != null ? satz : 19) / 100;
      const p = Number(preis);
      return round2(inkl ? p : p * f);
    };

    const varsByArt = {};
    vars.forEach(function (v) { (varsByArt[v.artikel_id] = varsByArt[v.artikel_id] || []).push(v); });

    const leistungen = rows.map(function (r) {
      const vlist = varsByArt[r.artikel_id] || [];
      const basisBrutto = r.preis != null ? toBrutto(r.preis, r.mwst_satz) : null;
      const varianten = vlist.map(function (v) {
        return {
          fahrzeug_typ: v.fahrzeug_typ || null,
          zoll_min: v.zoll_min != null ? v.zoll_min : null,
          zoll_max: v.zoll_max != null ? v.zoll_max : null,
          brutto: toBrutto(v.preis, v.mwst_satz)
        };
      });
      const alle = [];
      if (basisBrutto != null) alle.push(basisBrutto);
      varianten.forEach(function (v) { alle.push(v.brutto); });
      const ab = alle.length ? Math.min.apply(null, alle) : null;
      return {
        titel: r.titel,
        beschreibung: r.beschreibung || '',
        rolle: r.rolle,
        einheit: r.einheit || 'Stück',
        dauer_minuten: r.dauer_minuten != null ? r.dauer_minuten : null,
        ab_brutto: ab,
        basis_brutto: basisBrutto,
        gestaffelt: varianten.length > 0,
        varianten: varianten
      };
    });

    res.json({ inkl_mwst: inkl, leistungen: leistungen });
  } catch (e) { next(e); }
});

module.exports = router;
