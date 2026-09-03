'use strict';
// Gutscheine/Aktionscodes verwalten. Liegt auf dem Server unter src/routes/gutscheine.js.
// Gemountet (nur Mitarbeiter) als /api/gutscheine.
const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');

// LESEN darf jeder Mitarbeiter: Der Rechnungseditor muss einen Gutschein anwenden koennen.
// SCHREIBEN nur der Inhaber -- siehe requireAdmin an den einzelnen Routen unten.
//
// Entscheidung des Inhabers: Gutscheine wurden frueher im Homepage-CMS angelegt und geloescht.
// Ein Gutschein ist aber kein Gestaltungselement, sondern ein Preisnachlass, der auf der Rechnung
// landet -- WINTER2026 kostet je Einlagerung 10 Euro. Wer Rabatte vergeben darf, entscheidet der
// Betrieb, nicht das Werkzeug fuer die Website. Und: Im CMS durfte das jeder Mitarbeiter.
router.use(authenticate, requireStaff);

function normCode(c) { return String(c || '').trim().toUpperCase().replace(/\s+/g, ''); }

// Liste
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM gutscheine ORDER BY erstellt_am DESC');
    res.json(rows);
  } catch (e) { next(e); }
});

// Pruefen (fuer Rechnungs-Editor): nur gueltige aktive Codes
router.get('/pruefen/:code', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT code, rabatt_prozent, gueltig_bis FROM gutscheine
       WHERE UPPER(code)=UPPER($1) AND aktiv=true AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE)`,
      [normCode(req.params.code)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Code ungültig oder abgelaufen.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Anlegen
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const code = normCode(req.body.code);
    const rabatt = parseInt(req.body.rabatt_prozent);
    if (!code) return res.status(400).json({ error: 'Code ist Pflicht.' });
    if (!(rabatt >= 1 && rabatt <= 100)) return res.status(400).json({ error: 'Rabatt muss zwischen 1 und 100 % liegen.' });
    const exists = await query('SELECT id FROM gutscheine WHERE UPPER(code)=UPPER($1)', [code]);
    if (exists.rows.length) return res.status(409).json({ error: 'Diesen Code gibt es bereits.' });
    const { rows } = await query(
      'INSERT INTO gutscheine (code, beschreibung, rabatt_prozent, gueltig_bis, aktiv) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [code, req.body.beschreibung || null, rabatt, req.body.gueltig_bis || null, req.body.aktiv !== false]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// Aendern (aktiv-Status, Rabatt, Gueltigkeit, Beschreibung)
router.patch('/:id', requireAdmin, async (req, res, next) => {
  try {
    const cur = (await query('SELECT * FROM gutscheine WHERE id=$1', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Gutschein nicht gefunden.' });
    const rabatt = req.body.rabatt_prozent != null ? parseInt(req.body.rabatt_prozent) : cur.rabatt_prozent;
    const { rows } = await query(
      `UPDATE gutscheine SET beschreibung=$1, rabatt_prozent=$2, gueltig_bis=$3, aktiv=$4 WHERE id=$5 RETURNING *`,
      [req.body.beschreibung !== undefined ? req.body.beschreibung : cur.beschreibung,
       rabatt,
       req.body.gueltig_bis !== undefined ? (req.body.gueltig_bis || null) : cur.gueltig_bis,
       req.body.aktiv !== undefined ? !!req.body.aktiv : cur.aktiv,
       req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Loeschen
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM gutscheine WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Gutschein nicht gefunden.' });
    res.json({ message: 'Gelöscht.' });
  } catch (e) { next(e); }
});

module.exports = router;
