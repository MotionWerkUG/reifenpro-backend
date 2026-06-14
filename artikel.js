'use strict';
const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate, requireAdmin } = require('../middleware/auth');

function dauerWert(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v);
  return Number.isFinite(n) ? n : null;
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM artikel WHERE aktiv=true ORDER BY sortierung, name'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, beschreibung, preis, mwst_satz, einheit, dauer_minuten, kategorie, artikelnr } = req.body;
    if (!name) return res.status(400).json({ error: 'Name ist Pflicht.' });
    const { rows } = await query(
      `INSERT INTO artikel (name, beschreibung, preis, mwst_satz, einheit, dauer_minuten, kategorie, artikelnr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name.trim(), beschreibung || null, parseFloat(preis) || 0,
       parseFloat(mwst_satz) || 19, einheit || 'Stück',
       dauerWert(dauer_minuten), kategorie || 'sonstiges', artikelnr || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, beschreibung, preis, mwst_satz, einheit, dauer_minuten, kategorie, artikelnr, aktiv } = req.body;
    const { rows } = await query(
      `UPDATE artikel SET
         name=$1, beschreibung=$2, preis=$3, mwst_satz=$4, einheit=$5,
         dauer_minuten=$6, kategorie=$7, artikelnr=$8, aktiv=$9
       WHERE id=$10 RETURNING *`,
      [name, beschreibung || null, parseFloat(preis) || 0,
       parseFloat(mwst_satz) || 19, einheit || 'Stück',
       dauerWert(dauer_minuten), kategorie || 'sonstiges',
       artikelnr || null, aktiv !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await query('UPDATE artikel SET aktiv=false WHERE id=$1', [req.params.id]);
    res.json({ message: 'Artikel deaktiviert.' });
  } catch (err) { next(err); }
});

// ── PREIS-/ZEITSTAFFEL je Fahrzeugtyp und Zollgroesse ──
const FZ_TYPEN = ['PKW', 'SUV', 'Transporter', 'Motorrad', 'Sonstiges'];
function intOrNull(v) { return (v !== null && v !== undefined && v !== '') ? parseInt(v) : null; }

// Effektiven Preis/Dauer ermitteln: passendste Variante, sonst Artikel-Standard
function resolvePreis(artikel, varianten, typ, zoll) {
  const z = (zoll !== null && zoll !== undefined && zoll !== '') ? parseInt(zoll) : null;
  const passend = (varianten || []).filter(function (v) {
    const typOk = !v.fahrzeug_typ || v.fahrzeug_typ === typ;
    const zollOk = z === null || ((v.zoll_min === null || z >= v.zoll_min) && (v.zoll_max === null || z <= v.zoll_max));
    return typOk && zollOk;
  }).map(function (v) {
    const score = (v.fahrzeug_typ ? 2 : 0) + ((v.zoll_min !== null || v.zoll_max !== null) ? 1 : 0);
    return { v: v, score: score };
  }).sort(function (a, b) { return b.score - a.score; });
  if (passend.length) {
    const v = passend[0].v;
    return { quelle: 'variante', variante_id: v.id, preis: v.preis, mwst_satz: v.mwst_satz, dauer_minuten: v.dauer_minuten != null ? v.dauer_minuten : artikel.dauer_minuten };
  }
  return { quelle: 'basis', preis: artikel.preis, mwst_satz: artikel.mwst_satz, dauer_minuten: artikel.dauer_minuten };
}

router.get('/:id/preise', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM artikel_preise WHERE artikel_id=$1 ORDER BY fahrzeug_typ NULLS FIRST, zoll_min NULLS FIRST', [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id/preis', authenticate, async (req, res, next) => {
  try {
    const a = (await query('SELECT * FROM artikel WHERE id=$1', [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: 'Artikel nicht gefunden.' });
    const varianten = (await query('SELECT * FROM artikel_preise WHERE artikel_id=$1', [req.params.id])).rows;
    res.json(resolvePreis(a, varianten, req.query.typ || null, req.query.zoll));
  } catch (err) { next(err); }
});

router.post('/:id/preise', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { fahrzeug_typ, zoll_min, zoll_max, preis, mwst_satz, dauer_minuten } = req.body;
    const typ = FZ_TYPEN.includes(fahrzeug_typ) ? fahrzeug_typ : null;
    const { rows } = await query(
      `INSERT INTO artikel_preise (artikel_id, fahrzeug_typ, zoll_min, zoll_max, preis, mwst_satz, dauer_minuten)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, typ, intOrNull(zoll_min), intOrNull(zoll_max), parseFloat(preis) || 0, parseFloat(mwst_satz) || 19, intOrNull(dauer_minuten)]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id/preise/:vid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { fahrzeug_typ, zoll_min, zoll_max, preis, mwst_satz, dauer_minuten } = req.body;
    const typ = FZ_TYPEN.includes(fahrzeug_typ) ? fahrzeug_typ : null;
    const { rows } = await query(
      `UPDATE artikel_preise SET fahrzeug_typ=$1, zoll_min=$2, zoll_max=$3, preis=$4, mwst_satz=$5, dauer_minuten=$6
       WHERE id=$7 AND artikel_id=$8 RETURNING *`,
      [typ, intOrNull(zoll_min), intOrNull(zoll_max), parseFloat(preis) || 0, parseFloat(mwst_satz) || 19, intOrNull(dauer_minuten), req.params.vid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Variante nicht gefunden.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id/preise/:vid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM artikel_preise WHERE id=$1 AND artikel_id=$2 RETURNING id', [req.params.vid, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json({ message: 'Gelöscht.' });
  } catch (err) { next(err); }
});

module.exports = router;
