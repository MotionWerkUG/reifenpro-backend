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
    const cur = (await query('SELECT * FROM homepage_sektionen WHERE id=$1', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Abschnitt nicht gefunden.' });
    // Vorherigen Stand fuer Undo sichern (letzte 12 behalten)
    const snap = { headline: cur.headline, subline: cur.subline, inhalt: cur.inhalt, bild_url: cur.bild_url, cta_text: cur.cta_text, cta_url: cur.cta_url, sichtbar: cur.sichtbar };
    await query('INSERT INTO sektion_historie (sektion_id, daten, beschreibung) VALUES ($1,$2,$3)', [cur.id, JSON.stringify(snap), (cur.headline || cur.typ || 'Abschnitt')]);
    await query('DELETE FROM sektion_historie WHERE id NOT IN (SELECT id FROM sektion_historie ORDER BY id DESC LIMIT 12)');
    const { headline, subline, inhalt, bild_url, cta_text, cta_url, sichtbar } = req.body;
    const { rows } = await query(
      `UPDATE homepage_sektionen SET headline=$1, subline=$2, inhalt=$3, bild_url=$4, cta_text=$5, cta_url=$6, sichtbar=$7, geaendert_am=NOW()
       WHERE id=$8 RETURNING *`,
      [headline || null, subline || null, inhalt || null, bild_url || null, cta_text || null, cta_url || null, sichtbar !== false, req.params.id]
    );
    await regenerate();
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Letzte Aenderungen (fuer Undo-Anzeige)
router.get('/sektionen-historie', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, sektion_id, beschreibung, geaendert_am FROM sektion_historie ORDER BY id DESC LIMIT 5');
    res.json(rows);
  } catch (e) { next(e); }
});

// Letzte Aenderung rueckgaengig machen
router.post('/sektionen-undo', async (req, res, next) => {
  try {
    const h = (await query('SELECT * FROM sektion_historie ORDER BY id DESC LIMIT 1')).rows[0];
    if (!h) return res.status(400).json({ error: 'Keine Änderung zum Rückgängigmachen vorhanden.' });
    const d = h.daten || {};
    await query(
      `UPDATE homepage_sektionen SET headline=$1, subline=$2, inhalt=$3, bild_url=$4, cta_text=$5, cta_url=$6, sichtbar=$7, geaendert_am=NOW() WHERE id=$8`,
      [d.headline || null, d.subline || null, d.inhalt || null, d.bild_url || null, d.cta_text || null, d.cta_url || null, d.sichtbar !== false, h.sektion_id]
    );
    await query('DELETE FROM sektion_historie WHERE id=$1', [h.id]);
    await regenerate();
    res.json({ message: 'Rückgängig gemacht.', beschreibung: h.beschreibung });
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

// Aktionsbanner laden
router.get('/banner', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT aktion_aktiv, aktion_text, aktion_code, aktion_position, aktion_link FROM einstellungen ORDER BY id LIMIT 1');
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});

// Aktionsbanner speichern + Homepage neu erzeugen
router.put('/banner', async (req, res, next) => {
  try {
    const { aktion_aktiv, aktion_text, aktion_code, aktion_position, aktion_link } = req.body;
    const pos = ['leiste', 'ecke-links', 'ecke-rechts'].includes(aktion_position) ? aktion_position : 'leiste';
    const upd = await query(
      `UPDATE einstellungen SET aktion_aktiv=$1, aktion_text=$2, aktion_code=$3, aktion_position=$4, aktion_link=$5
       WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1) RETURNING aktion_aktiv`,
      [aktion_aktiv === true, aktion_text || null, aktion_code || null, pos, aktion_link || null]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Einstellungen nicht gefunden.' });
    await regenerate();
    res.json({ message: 'Banner gespeichert.' });
  } catch (e) { next(e); }
});

// Navigationsbuttons laden
const DEFAULT_NAV = [
  { label: 'Leistungen', url: '#leistungen', sichtbar: true, btn: false },
  { label: 'Termin buchen', url: '/termin/', sichtbar: true, btn: false },
  { label: 'Öffnungszeiten', url: '#oeffnungszeiten', sichtbar: true, btn: false },
  { label: 'Kontakt', url: '#kontakt', sichtbar: true, btn: false },
  { label: 'Kundenportal', url: '/portal/', sichtbar: true, btn: true }
];
router.get('/nav', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT nav_links FROM einstellungen ORDER BY id LIMIT 1');
    const nav = rows[0] && Array.isArray(rows[0].nav_links) && rows[0].nav_links.length ? rows[0].nav_links : DEFAULT_NAV;
    res.json(nav);
  } catch (e) { next(e); }
});

// Navigationsbuttons speichern + Homepage neu erzeugen
router.put('/nav', async (req, res, next) => {
  try {
    const eingabe = Array.isArray(req.body) ? req.body : (req.body && req.body.nav_links);
    if (!Array.isArray(eingabe)) return res.status(400).json({ error: 'Liste der Navigationspunkte erforderlich.' });
    const nav = eingabe
      .filter((i) => i && typeof i.label === 'string' && i.label.trim())
      .slice(0, 12)
      .map((i) => ({
        label: String(i.label).trim().slice(0, 40),
        url: String(i.url || '#').trim().slice(0, 300),
        sichtbar: i.sichtbar !== false,
        btn: i.btn === true
      }));
    if (!nav.length) return res.status(400).json({ error: 'Mindestens ein Navigationspunkt erforderlich.' });
    const upd = await query(
      `UPDATE einstellungen SET nav_links=$1 WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1) RETURNING id`,
      [JSON.stringify(nav)]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Einstellungen nicht gefunden.' });
    await regenerate();
    res.json({ message: 'Navigation gespeichert.' });
  } catch (e) { next(e); }
});

// Online-Buchungsbereich (Gäste) laden
router.get('/buchung', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT buchung_aktiv, buchung_titel, buchung_text FROM einstellungen ORDER BY id LIMIT 1');
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});

// Online-Buchungsbereich speichern + Homepage neu erzeugen
router.put('/buchung', async (req, res, next) => {
  try {
    const { buchung_aktiv, buchung_titel, buchung_text } = req.body;
    const upd = await query(
      `UPDATE einstellungen SET buchung_aktiv=$1, buchung_titel=$2, buchung_text=$3
       WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1) RETURNING buchung_aktiv`,
      [buchung_aktiv === true, buchung_titel || null, buchung_text || null]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Einstellungen nicht gefunden.' });
    await regenerate();
    res.json({ message: 'Buchungsbereich gespeichert.' });
  } catch (e) { next(e); }
});

// ── Buchungs-Leistungen (Haupt-/Zusatzleistungen fuer den Buchungsassistenten) ──
router.get('/leistungen', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT bl.*, a.name AS artikel_name, a.dauer_minuten
       FROM buchung_leistungen bl JOIN artikel a ON a.id = bl.artikel_id
       ORDER BY bl.rolle, bl.sortierung, a.name`);
    res.json(rows);
  } catch (e) { next(e); }
});
router.post('/leistungen', async (req, res, next) => {
  try {
    const { artikel_id, rolle, titel, beschreibung, bild_url, sortierung } = req.body;
    if (!artikel_id) return res.status(400).json({ error: 'Leistung (Artikel) ist Pflicht.' });
    const r = ['haupt', 'zusatz'].includes(rolle) ? rolle : 'haupt';
    const max = (await query('SELECT COALESCE(MAX(sortierung),0)+1 AS s FROM buchung_leistungen WHERE rolle=$1', [r])).rows[0].s;
    const { rows } = await query(
      'INSERT INTO buchung_leistungen (artikel_id, rolle, titel, beschreibung, bild_url, sortierung) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [artikel_id, r, titel || null, beschreibung || null, bild_url || null, sortierung != null ? sortierung : max]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});
router.put('/leistungen/:id', async (req, res, next) => {
  try {
    const cur = (await query('SELECT * FROM buchung_leistungen WHERE id=$1', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Nicht gefunden.' });
    const { titel, beschreibung, bild_url, sortierung, aktiv, artikel_id, rolle } = req.body;
    const { rows } = await query(
      `UPDATE buchung_leistungen SET artikel_id=$1, rolle=$2, titel=$3, beschreibung=$4, bild_url=$5, sortierung=$6, aktiv=$7 WHERE id=$8 RETURNING *`,
      [artikel_id || cur.artikel_id, ['haupt', 'zusatz'].includes(rolle) ? rolle : cur.rolle,
       titel !== undefined ? titel : cur.titel, beschreibung !== undefined ? beschreibung : cur.beschreibung,
       bild_url !== undefined ? bild_url : cur.bild_url, sortierung != null ? sortierung : cur.sortierung,
       aktiv !== undefined ? !!aktiv : cur.aktiv, req.params.id]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});
router.delete('/leistungen/:id', async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM buchung_leistungen WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json({ message: 'Gelöscht.' });
  } catch (e) { next(e); }
});

module.exports = router;
