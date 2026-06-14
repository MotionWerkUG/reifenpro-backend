'use strict';
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { query } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { regenerate } = require('../lib/homepage-generate');
const { verarbeite } = require('../lib/bildverarbeitung');

const UPLOAD_DIR = '/var/www/schroeder-homepage/uploads';
const TYPEN = ['hero', 'leistung', 'text', 'oeffnungszeiten', 'kontakt'];

router.use(authenticate, requireStaff);

router.get('/sektionen', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM homepage_sektionen ORDER BY sortierung');
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/sektionen', async (req, res, next) => {
  try {
    const typ = TYPEN.includes(req.body.typ) ? req.body.typ : 'text';
    const max = (await query('SELECT COALESCE(MAX(sortierung),0)+10 AS s FROM homepage_sektionen')).rows[0].s;
    const { rows } = await query(
      'INSERT INTO homepage_sektionen (typ, sortierung, headline, inhalt) VALUES ($1,$2,$3,$4) RETURNING *',
      [typ, max, typ === 'leistung' ? 'Neue Leistung' : 'Neuer Abschnitt', 'Text hier eingeben …']
    );
    await regenerate();
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/sektionen/:id', async (req, res, next) => {
  try {
    const { headline, subline, inhalt, bild_url, cta_text, cta_url, sichtbar } = req.body;
    const { rows } = await query(
      `UPDATE homepage_sektionen SET headline=$1, subline=$2, inhalt=$3, bild_url=$4, cta_text=$5, cta_url=$6, sichtbar=$7, geaendert_am=NOW()
       WHERE id=$8 RETURNING *`,
      [headline || null, subline || null, inhalt || null, bild_url || null, cta_text || null, cta_url || null, sichtbar !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Abschnitt nicht gefunden.' });
    await regenerate();
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/sektionen/:id', async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM homepage_sektionen WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Abschnitt nicht gefunden.' });
    await regenerate();
    res.json({ message: 'Gelöscht.' });
  } catch (e) { next(e); }
});

router.post('/sektionen/:id/move', async (req, res, next) => {
  try {
    const up = req.body.dir === 'up';
    const cur = (await query('SELECT * FROM homepage_sektionen WHERE id=$1', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Abschnitt nicht gefunden.' });
    const nb = (await query(
      'SELECT * FROM homepage_sektionen WHERE sortierung ' + (up ? '<' : '>') + ' $1 ORDER BY sortierung ' + (up ? 'DESC' : 'ASC') + ' LIMIT 1',
      [cur.sortierung]
    )).rows[0];
    if (nb) {
      await query('UPDATE homepage_sektionen SET sortierung=$1 WHERE id=$2', [nb.sortierung, cur.id]);
      await query('UPDATE homepage_sektionen SET sortierung=$1 WHERE id=$2', [cur.sortierung, nb.id]);
      await regenerate();
    }
    res.json({ message: 'ok' });
  } catch (e) { next(e); }
});

router.post('/bild', async (req, res, next) => {
  try {
    const { data, format } = req.body;
    const m = /^data:(image\/(png|jpe?g|webp|gif|heic|heif));base64,(.+)$/.exec(data || '');
    if (!m) return res.status(400).json({ error: 'Ungültiges Bildformat (JPG/PNG/WEBP/HEIC).' });
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    // Jedes Bild wird passend zugeschnitten und komprimiert -> JPG.
    const out = await verarbeite(Buffer.from(m[3], 'base64'), format === 'hero' ? 'hero' : 'inhalt');
    const name = 'img-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.jpg';
    fs.writeFileSync(path.join(UPLOAD_DIR, name), out);
    res.json({ url: '/uploads/' + name });
  } catch (e) { next(e); }
});

router.post('/render', async (req, res, next) => {
  try { await regenerate(); res.json({ message: 'Homepage neu erzeugt.' }); } catch (e) { next(e); }
});

module.exports = router;
