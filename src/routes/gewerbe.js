'use strict';
// Gewerbe-Zugang-Anfragen (mit Upload der Gewerbeanmeldung). Liegt auf dem Server unter src/routes/gewerbe.js.
// Gemountet als /api/gewerbe. POST ist oeffentlich, Verwaltung nur fuer Mitarbeiter.
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { query } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');

// Dokumente liegen NICHT im Webroot (Zugriff nur ueber authentifizierten Endpunkt)
const DOK_DIR = path.join(__dirname, '..', '..', 'gewerbe-dokumente');
const limiter = rateLimit({ windowMs: 900000, max: 5, message: { error: 'Zu viele Anfragen. Bitte später erneut versuchen.' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// HTML-Escape fuer Freitext, der in die Benachrichtigungs-Mail interpoliert wird (kein HTML-Injection).
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── POST /api/gewerbe ── oeffentliche Gewerbe-Zugang-Anfrage ──
router.post('/', limiter, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ message: 'ok' }); // Honeypot
    const { firma, anrede, ansprechpartner, ust_id, telefon, email, anzahl_fahrzeuge, nachricht, datenschutz, dokument } = b;
    if (!firma || !ansprechpartner || !telefon || !email)
      return res.status(400).json({ error: 'Bitte Firma, Ansprechpartner, Telefon und E-Mail ausfüllen.' });
    if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
    if (datenschutz !== true) return res.status(400).json({ error: 'Bitte stimmen Sie der Datenschutzerklärung zu.' });

    // Optionales Dokument (Gewerbeanmeldung) – PDF oder Bild, als Daten-URL
    let dokPfad = null, dokName = null;
    if (dokument) {
      const m = /^data:(application\/pdf|image\/(png|jpe?g|webp|heic|heif));base64,(.+)$/.exec(String(dokument));
      if (!m) return res.status(400).json({ error: 'Dokument muss PDF, JPG oder PNG sein.' });
      const buf = Buffer.from(m[3], 'base64');
      if (buf.length > 15 * 1024 * 1024) return res.status(400).json({ error: 'Dokument zu groß (max. 15 MB).' });
      if (!fs.existsSync(DOK_DIR)) fs.mkdirSync(DOK_DIR, { recursive: true });
      const ext = m[1] === 'application/pdf' ? 'pdf' : (m[2] === 'jpeg' ? 'jpg' : m[2]);
      dokName = 'Gewerbeanmeldung.' + ext;
      const fname = 'gw-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.' + ext;
      fs.writeFileSync(path.join(DOK_DIR, fname), buf);
      dokPfad = fname;
    }

    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    const ins = await query(
      `INSERT INTO gewerbe_anfragen (firma, anrede, ansprechpartner, ust_id, telefon, email, anzahl_fahrzeuge, nachricht, dokument_pfad, dokument_name, datenschutz_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [String(firma).slice(0, 200), anrede || null, String(ansprechpartner).slice(0, 160), ust_id || null,
       String(telefon).slice(0, 60), String(email).slice(0, 160),
       anzahl_fahrzeuge ? parseInt(anzahl_fahrzeuge) : null, nachricht ? String(nachricht).slice(0, 3000) : null,
       dokPfad, dokName, ip]);

    // Admin benachrichtigen (Fehler darf die Anfrage nicht verlieren)
    try {
      const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
      const ziel = einst.email || process.env.SMTP_USER;
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      await transporter.sendMail({
        from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: ziel, replyTo: email,
        subject: 'Neue Gewerbe-Zugang-Anfrage: ' + String(firma).replace(/[\r\n]+/g, ' '),
        html: '<p><strong>Neue Gewerbe-Zugang-Anfrage über die Website:</strong></p>' +
          '<p>Firma: ' + esc(firma) + '<br>Ansprechpartner: ' + (anrede ? esc(anrede) + ' ' : '') + esc(ansprechpartner) +
          '<br>USt-IdNr.: ' + (ust_id ? esc(ust_id) : '–') + '<br>Telefon: ' + esc(telefon) + '<br>E-Mail: ' + esc(email) +
          '<br>Anzahl Fahrzeuge: ' + (anzahl_fahrzeuge ? esc(anzahl_fahrzeuge) : '–') + '</p>' +
          (nachricht ? '<p>Nachricht: ' + esc(nachricht) + '</p>' : '') +
          '<p>' + (dokPfad ? 'Gewerbeanmeldung wurde hochgeladen.' : 'Kein Dokument hochgeladen.') + '</p>' +
          '<p>Im Admin unter „Gewerbe-Anfragen" ansehen und Kunden anlegen.</p>'
      });
    } catch (e) { console.error('[Gewerbe-Anfrage-Mail]', e.message); }

    res.status(201).json({ message: 'ok' });
  } catch (e) { next(e); }
});

// ── Ab hier nur fuer Mitarbeiter ──
router.get('/', authenticate, requireStaff, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, firma, anrede, ansprechpartner, ust_id, telefon, email, anzahl_fahrzeuge, nachricht, (dokument_pfad IS NOT NULL) AS hat_dokument, erledigt, erstellt_am FROM gewerbe_anfragen ORDER BY erstellt_am DESC');
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id/dokument', authenticate, requireStaff, async (req, res, next) => {
  try {
    const a = (await query('SELECT dokument_pfad, dokument_name FROM gewerbe_anfragen WHERE id=$1', [req.params.id])).rows[0];
    if (!a || !a.dokument_pfad) return res.status(404).json({ error: 'Kein Dokument.' });
    const p = path.join(DOK_DIR, a.dokument_pfad);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Datei nicht gefunden.' });
    res.setHeader('Content-Disposition', 'inline; filename="' + (a.dokument_name || 'dokument') + '"');
    res.sendFile(p);
  } catch (e) { next(e); }
});

router.patch('/:id', authenticate, requireStaff, async (req, res, next) => {
  try {
    const { rows } = await query('UPDATE gewerbe_anfragen SET erledigt=$1 WHERE id=$2 RETURNING id', [req.body.erledigt === true, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
    res.json({ message: 'ok' });
  } catch (e) { next(e); }
});

module.exports = router;
