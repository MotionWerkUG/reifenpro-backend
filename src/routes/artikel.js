'use strict';
const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { resolvePreis } = require('../lib/preis');

function dauerWert(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v);
  return Number.isFinite(n) ? n : null;
}

// Buchungsassistent-Rolle je Artikel steuern (Admin ist Herr ueber Haupt/Zusatz).
// Schreibt/aktualisiert die gemeinsame Tabelle buchung_leistungen; das Bild bleibt
// Sache der Homepage. Deaktivieren statt loeschen -> Bild/Titel bleiben fuer spaeter erhalten.
async function applyBuchungRolle(artikelId, rolle, name) {
  const r = (rolle === 'haupt' || rolle === 'zusatz') ? rolle : null;
  const vorhanden = (await query('SELECT id FROM buchung_leistungen WHERE artikel_id=$1 LIMIT 1', [artikelId])).rows[0];
  if (r) {
    if (vorhanden) {
      await query('UPDATE buchung_leistungen SET rolle=$1, aktiv=true WHERE artikel_id=$2', [r, artikelId]);
    } else {
      const sort = (await query('SELECT COALESCE(MAX(sortierung),0)+10 AS s FROM buchung_leistungen', [])).rows[0].s;
      await query(
        'INSERT INTO buchung_leistungen (artikel_id, rolle, titel, sortierung, aktiv) VALUES ($1,$2,$3,$4,true)',
        [artikelId, r, name || null, sort]
      );
    }
  } else if (vorhanden) {
    await query('UPDATE buchung_leistungen SET aktiv=false WHERE artikel_id=$1', [artikelId]);
  }
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, CASE WHEN bl.aktiv THEN bl.rolle ELSE NULL END AS buchung_rolle
       FROM artikel a
       LEFT JOIN buchung_leistungen bl ON bl.artikel_id = a.id
       WHERE a.aktiv=true ORDER BY a.sortierung, a.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, beschreibung, preis, mwst_satz, einheit, dauer_minuten, kategorie, artikelnr, buchung_rolle } = req.body;
    if (!name) return res.status(400).json({ error: 'Name ist Pflicht.' });
    if ((buchung_rolle === 'haupt' || buchung_rolle === 'zusatz') && dauerWert(dauer_minuten) === null) {
      return res.status(400).json({ error: 'Buchbare Leistungen (Haupt-/Zusatzleistung) brauchen eine Dauer in Minuten.' });
    }
    const { rows } = await query(
      `INSERT INTO artikel (name, beschreibung, preis, mwst_satz, einheit, dauer_minuten, kategorie, artikelnr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name.trim(), beschreibung || null, parseFloat(preis) || 0,
       parseFloat(mwst_satz) || 19, einheit || 'Stück',
       dauerWert(dauer_minuten), kategorie || 'sonstiges', artikelnr || null]
    );
    if ('buchung_rolle' in req.body) await applyBuchungRolle(rows[0].id, buchung_rolle, rows[0].name);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, beschreibung, preis, mwst_satz, einheit, dauer_minuten, kategorie, artikelnr, aktiv, buchung_rolle } = req.body;
    if ((buchung_rolle === 'haupt' || buchung_rolle === 'zusatz') && dauerWert(dauer_minuten) === null) {
      return res.status(400).json({ error: 'Buchbare Leistungen (Haupt-/Zusatzleistung) brauchen eine Dauer in Minuten.' });
    }
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
    // Nur anfassen, wenn das Feld explizit mitkommt -> Teil-Updates loeschen die Rolle nicht versehentlich.
    if ('buchung_rolle' in req.body) await applyBuchungRolle(req.params.id, buchung_rolle, rows[0].name);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await query('UPDATE artikel SET aktiv=false WHERE id=$1', [req.params.id]);
    // Zugehoerige Buchungszeile mit deaktivieren -> keine Leiche, die online sichtbar bleibt.
    await query('UPDATE buchung_leistungen SET aktiv=false WHERE artikel_id=$1', [req.params.id]);
    res.json({ message: 'Artikel deaktiviert.' });
  } catch (err) { next(err); }
});

// ── PREIS-/ZEITSTAFFEL je Fahrzeugtyp und Zollgroesse ──
const FZ_TYPEN = ['PKW', 'SUV', 'Transporter', 'Motorrad', 'Sonstiges'];
function intOrNull(v) { return (v !== null && v !== undefined && v !== '') ? parseInt(v) : null; }

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
