'use strict';
const express = require('express');
const router = express.Router();
const { query } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { portalMailHtml, anredeGruss } = require('../lib/mail-template');

// Alle Termin-Routen sind rein intern (Admin/Werkstatt) — Personal-Rechte erzwingen.
router.use(authenticate, requireStaff);

// ── GET /api/termine ── Admin: alle Termine
router.get('/', async (req, res, next) => {
  try {
    const { von, bis, status } = req.query;
    let sql = `SELECT t.*,
      k.vorname || ' ' || k.nachname as kundenname,
      k.kennzeichen, k.telefon,
      a.name as artikel_name, a.dauer_minuten,
      f.marke as fahrzeug_marke, f.modell as fahrzeug_modell
      FROM termine t
      LEFT JOIN kunden k ON k.id = t.kunden_id
      LEFT JOIN artikel a ON a.id = t.artikel_id
      LEFT JOIN fahrzeuge f ON f.id = t.fahrzeug_id
      WHERE 1=1`;
    const params = [];
    if (von) { params.push(von); sql += ` AND t.datum >= $${params.length}`; }
    if (bis) { params.push(bis); sql += ` AND t.datum <= $${params.length}`; }
    if (status) { params.push(status); sql += ` AND t.status = $${params.length}`; }
    sql += ' ORDER BY t.datum, t.uhrzeit_von';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// ── GET /api/termine/statistik ── Monatsauslastung
router.get('/statistik', async (req, res, next) => {
  try {
    const { jahr } = req.query;
    const j = parseInt(jahr) || new Date().getFullYear();
    const { rows } = await query(
      `SELECT
        EXTRACT(MONTH FROM datum) as monat,
        COUNT(CASE WHEN status != 'storniert' THEN 1 END) as anzahl,
        COUNT(CASE WHEN status='storniert' THEN 1 END) as storniert,
        COUNT(CASE WHEN portal_buchung=true AND status != 'storniert' THEN 1 END) as online
       FROM termine
       WHERE EXTRACT(YEAR FROM datum) = $1
       GROUP BY monat ORDER BY monat`,
      [j]
    );
    // Alle 12 Monate ausgeben (auch leere)
    const monate = Array.from({ length: 12 }, (_, i) => {
      const found = rows.find(r => parseInt(r.monat) === i + 1);
      return { monat: i + 1, anzahl: found ? parseInt(found.anzahl) : 0, storniert: found ? parseInt(found.storniert) : 0, online: found ? parseInt(found.online) : 0 };
    });
    res.json({ jahr: j, monate });
  } catch (e) { next(e); }
});

// ── GET /api/termine/betriebsurlaub ──
router.get('/betriebsurlaub', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM betriebsurlaub ORDER BY von_datum');
    res.json(rows);
  } catch (e) { next(e); }
});

// ── POST /api/termine/betriebsurlaub ──
router.post('/betriebsurlaub', async (req, res, next) => {
  try {
    const { von_datum, bis_datum, beschreibung } = req.body;
    if (!von_datum || !bis_datum) return res.status(400).json({ error: 'Von und Bis erforderlich' });
    const { rows } = await query(
      'INSERT INTO betriebsurlaub (von_datum, bis_datum, beschreibung) VALUES ($1,$2,$3) RETURNING *',
      [von_datum, bis_datum, beschreibung || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ── DELETE /api/termine/betriebsurlaub/:id ──
router.delete('/betriebsurlaub/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM betriebsurlaub WHERE id=$1', [req.params.id]);
    res.json({ message: 'Gelöscht' });
  } catch (e) { next(e); }
});

// ── GET /api/termine/:id ──
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.*, k.vorname || ' ' || k.nachname as kundenname, k.kennzeichen, k.telefon, a.name as artikel_name, a.dauer_minuten
       FROM termine t LEFT JOIN kunden k ON k.id=t.kunden_id LEFT JOIN artikel a ON a.id=t.artikel_id
       WHERE t.id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── POST /api/termine ── Admin: Termin anlegen
router.post('/', async (req, res, next) => {
  try {
    const { kunden_id, kontakt_name, kontakt_telefon, kontakt_email, datum, uhrzeit_von, uhrzeit_bis, termin_typ, artikel_id, kennzeichen, beschreibung, notizen_intern, fahrzeug_id } = req.body;
    if (!datum || !uhrzeit_von || !uhrzeit_bis) return res.status(400).json({ error: 'Datum und Uhrzeiten erforderlich' });
    const { rows } = await query(
      `INSERT INTO termine (kunden_id, kontakt_name, kontakt_telefon, kontakt_email, datum, uhrzeit_von, uhrzeit_bis, termin_typ, artikel_id, kennzeichen, beschreibung, notizen_intern, fahrzeug_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'bestaetigt') RETURNING *`,
      [kunden_id || null, kontakt_name || null, kontakt_telefon || null, kontakt_email || null, datum, uhrzeit_von, uhrzeit_bis, termin_typ || null, artikel_id || null, kennzeichen || null, beschreibung || null, notizen_intern || null, fahrzeug_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ── PUT /api/termine/:id ──
router.put('/:id', async (req, res, next) => {
  try {
    const { datum, uhrzeit_von, uhrzeit_bis, termin_typ, artikel_id, kennzeichen, beschreibung, notizen_intern, status } = req.body;
    const { rows } = await query(
      `UPDATE termine SET datum=$1, uhrzeit_von=$2, uhrzeit_bis=$3, termin_typ=$4, artikel_id=$5,
       kennzeichen=$6, beschreibung=$7, notizen_intern=$8, status=COALESCE($9, status), geaendert_am=NOW()
       WHERE id=$10 RETURNING *`,
      [datum, uhrzeit_von, uhrzeit_bis, termin_typ, artikel_id || null, kennzeichen, beschreibung, notizen_intern, status || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── PATCH /api/termine/:id/status ── nur Status setzen (z.B. Werkstatt: erledigt)
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const erlaubt = ['angefragt', 'bestaetigt', 'abgeschlossen', 'storniert'];
    if (!erlaubt.includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });
    // Storno-Metadaten konsistent setzen (wie im DELETE-Pfad); Reaktivierung raeumt sie wieder ab
    const { rows } = await query(
      `UPDATE termine SET status=$1, geaendert_am=NOW(),
         storniert_am  = CASE WHEN $1='storniert' THEN COALESCE(storniert_am, NOW())   ELSE NULL END,
         storniert_von = CASE WHEN $1='storniert' THEN COALESCE(storniert_von, 'admin') ELSE NULL END
       WHERE id=$2 RETURNING *`,
      [status, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── DELETE /api/termine/:id ── Admin: Termin absagen
router.delete('/:id', async (req, res, next) => {
  try {
    const { grund } = req.body || {};
    const termin = await query('SELECT t.*, k.portal_email, k.vorname FROM termine t LEFT JOIN kunden k ON k.id=t.kunden_id WHERE t.id=$1', [req.params.id]);
    if (!termin.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    const t = termin.rows[0];
    if (t.status === 'storniert') return res.json({ message: 'Termin war bereits abgesagt' });
    await query("UPDATE termine SET status='storniert', storniert_am=COALESCE(storniert_am, NOW()), storniert_von=COALESCE(storniert_von, 'admin') WHERE id=$1", [req.params.id]);
    // Kunden informieren falls Portal-Buchung
    if (t.portal_buchung && t.portal_email) {
      const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      const datumF = new Date(t.datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      await transporter.sendMail({
        from: '"' + (einst.firmenname || 'ReifenPro') + '" <' + process.env.SMTP_USER + '>',
        to: t.portal_email,
        subject: 'Termin abgesagt — ' + datumF,
        html: '<p>Hallo ' + (t.vorname || '') + ',</p><p>Ihr Termin am ' + datumF + ' um ' + t.uhrzeit_von + ' Uhr muss leider abgesagt werden.' + (grund ? '<br>Grund: ' + grund : '') + '</p><p>Bitte buchen Sie einen neuen Termin oder rufen Sie uns an: ' + (einst.telefon || '') + '</p>'
      }).catch(() => {});
    }
    res.json({ message: 'Termin abgesagt' });
  } catch (e) { next(e); }
});

// ── POST /api/termine/portal-freigabe/:kundenId ── Kunde freigeben
router.post('/portal-freigabe/:kundenId', async (req, res, next) => {
  try {
    const { rows } = await query(
      'UPDATE kunden SET portal_freigegeben=true, geaendert_am=NOW() WHERE id=$1 RETURNING vorname, nachname, anrede, portal_email',
      [req.params.kundenId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kunde nicht gefunden' });
    const k = rows[0];
    // Willkommens-E-Mail
    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    const portalUrl = einst.portal_url || 'http://161.97.187.239/reifenpro/portal/';
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await transporter.sendMail({
      from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>',
      to: k.portal_email,
      subject: 'Ihr Kundenportal ist freigeschaltet — Schröder & Scholz',
      html: portalMailHtml(einst, {
        titel: 'Ihr Kundenportal ist freigeschaltet',
        gruss: anredeGruss(k.anrede, k.vorname, k.nachname),
        absaetze: [
          'Ihr Zugang zum Kundenportal von Schröder &amp; Scholz ist ab sofort freigeschaltet.',
          'Sie können sich jetzt anmelden, Ihre eingelagerten Räder einsehen und bequem online Ihre Termine buchen.'
        ],
        button: { text: 'Zum Kundenportal', url: portalUrl }
      })
    }).catch(() => {});
    res.json({ message: 'Freigegeben und E-Mail gesendet' });
  } catch (e) { next(e); }
});

module.exports = router;
