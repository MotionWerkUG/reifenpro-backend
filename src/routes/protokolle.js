'use strict';
// Digitales Annahme-/Uebergabeprotokoll: Fotos, Checkliste, Unterschrift, PDF.
// Fotos/Unterschriften liegen PRIVAT (nicht im oeffentlichen uploads/) und werden nur
// ueber die authentifizierte Route /datei/:name ausgeliefert (Kundendaten!).
// Liegt auf dem Server unter src/routes/protokolle.js
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { query } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const { erzeugeProtokollPdf, DATEI_DIR } = require('../lib/protokoll-pdf');

router.use(authenticate, requireStaff);

function sicherName(n) { return /^[A-Za-z0-9._-]+$/.test(String(n || '')) ? String(n) : null; }

// ── POST /foto ── Foto (data-URL) speichern, komprimiert
router.post('/foto', async (req, res, next) => {
  try {
    const m = /^data:image\/(png|jpe?g|webp|heic|heif);base64,(.+)$/.exec((req.body && req.body.data) || '');
    if (!m) return res.status(400).json({ error: 'Ungültiges Bildformat (JPG/PNG/WEBP/HEIC).' });
    if (!fs.existsSync(DATEI_DIR)) fs.mkdirSync(DATEI_DIR, { recursive: true, mode: 0o700 });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 15 * 1024 * 1024) return res.status(413).json({ error: 'Bild zu groß (max. 15 MB).' });
    const name = 'foto-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.jpg';
    const out = await sharp(buf).rotate().resize(1280, 960, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    fs.writeFileSync(path.join(DATEI_DIR, name), out);
    res.json({ datei: name });
  } catch (e) { next(e); }
});

// ── GET /datei/:name ── Foto/Unterschrift ausliefern (nur angemeldetes Personal)
router.get('/datei/:name', async (req, res) => {
  const n = sicherName(req.params.name);
  if (!n) return res.status(400).send('Ungültiger Dateiname.');
  const p = path.join(DATEI_DIR, n);
  if (!p.startsWith(DATEI_DIR) || !fs.existsSync(p)) return res.status(404).send('Nicht gefunden.');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(p);
});

// ── GET / ── Liste (optional gefiltert)
router.get('/', async (req, res, next) => {
  try {
    const params = [];
    let sql = `SELECT p.*, k.vorname||' '||k.nachname AS kundenname, k.kunden_nr
               FROM protokolle p LEFT JOIN kunden k ON k.id=p.kunden_id WHERE 1=1`;
    if (req.query.kunden_id) { params.push(req.query.kunden_id); sql += ' AND p.kunden_id=$' + params.length; }
    if (req.query.einlagerung_id) { params.push(req.query.einlagerung_id); sql += ' AND p.einlagerung_id=$' + params.length; }
    sql += ' ORDER BY p.erstellt_am DESC LIMIT 200';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// ── GET /:id ── Einzelprotokoll
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, k.vorname||' '||k.nachname AS kundenname, k.kunden_nr
       FROM protokolle p LEFT JOIN kunden k ON k.id=p.kunden_id WHERE p.id::text=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Protokoll nicht gefunden.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── POST / ── Protokoll anlegen + PDF erzeugen
router.post('/', async (req, res, next) => {
  try {
    const { typ, kunden_id, einlagerung_id, kennzeichen, km_stand, checkliste, maengel, fotos, unterschrift, unterschrift_name } = req.body || {};
    if (!kunden_id) return res.status(400).json({ error: 'Kunde ist Pflicht.' });
    const t = ['annahme', 'uebergabe'].includes(typ) ? typ : 'annahme';
    const k = (await query('SELECT * FROM kunden WHERE id::text=$1', [String(kunden_id)])).rows[0];
    if (!k) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

    // Unterschrift (data-URL) speichern
    let sigDatei = null;
    const sm = /^data:image\/png;base64,(.+)$/.exec(unterschrift || '');
    if (sm) {
      if (!fs.existsSync(DATEI_DIR)) fs.mkdirSync(DATEI_DIR, { recursive: true, mode: 0o700 });
      sigDatei = 'sig-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.png';
      fs.writeFileSync(path.join(DATEI_DIR, sigDatei), Buffer.from(sm[1], 'base64'));
    }
    // Nur bekannte, sichere Dateinamen uebernehmen
    const fotoListe = (Array.isArray(fotos) ? fotos : []).map(sicherName).filter(Boolean).slice(0, 8);

    const ins = await query(
      `INSERT INTO protokolle (typ, kunden_id, einlagerung_id, kennzeichen, km_stand, checkliste, maengel, fotos,
        unterschrift_datei, unterschrift_name, erstellt_von)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [t, k.id, einlagerung_id || null, (kennzeichen || k.kennzeichen || null),
       (function () { var v = parseInt(km_stand); return (Number.isFinite(v) && v >= 0 && v <= 9999999) ? v : null; })(),
       JSON.stringify(Array.isArray(checkliste) ? checkliste : []), maengel || null,
       JSON.stringify(fotoListe), sigDatei, unterschrift_name || null, req.user.id]);
    const p = ins.rows[0];

    // PDF erzeugen (Fehler darf das Protokoll nicht verlieren)
    try {
      const f = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
      const pdf = await erzeugeProtokollPdf(p, k, f);
      await query('UPDATE protokolle SET pdf_pfad=$1 WHERE id=$2', [pdf, p.id]);
      p.pdf_pfad = pdf;
    } catch (e) { console.error('[Protokoll-PDF]', e.message); }

    await auditLog({ userId: req.user.id, aktion: 'protokoll.erstellt', tabelle: 'protokolle', datensatzId: p.id, neueWerte: { typ: t }, req });
    res.status(201).json(p);
  } catch (e) { next(e); }
});

// ── GET /:id/pdf ── PDF ausliefern (bei Bedarf neu erzeugen)
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const p = (await query('SELECT * FROM protokolle WHERE id::text=$1', [req.params.id])).rows[0];
    if (!p) return res.status(404).json({ error: 'Protokoll nicht gefunden.' });
    let pfad = p.pdf_pfad;
    if (!pfad || !fs.existsSync(pfad)) {
      const k = (await query('SELECT * FROM kunden WHERE id=$1', [p.kunden_id])).rows[0] || {};
      const f = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
      pfad = await erzeugeProtokollPdf(p, k, f);
      await query('UPDATE protokolle SET pdf_pfad=$1 WHERE id=$2', [pfad, p.id]);
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + (p.typ === 'uebergabe' ? 'Uebergabeprotokoll' : 'Annahmeprotokoll') + '.pdf"');
    fs.createReadStream(pfad).pipe(res);
  } catch (e) { next(e); }
});

module.exports = router;
