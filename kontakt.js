'use strict';
// Oeffentliches Kontaktformular der Homepage. Speichert Anfragen und benachrichtigt die Firma.
// Liegt auf dem Server unter src/routes/kontakt.js. Gemountet (oeffentlich) als /api/kontakt.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { query } = require('../db/index');
const { portalMailHtml } = require('../lib/mail-template');

const limiter = rateLimit({ windowMs: 900000, max: 5, message: { error: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

router.post('/', limiter, async (req, res, next) => {
  try {
    const { name, email, telefon, nachricht, datenschutz, website } = req.body || {};
    if (website) return res.json({ message: 'ok' }); // Honeypot: Bots ausfiltern
    if (!name || !email || !nachricht) return res.status(400).json({ error: 'Bitte Name, E-Mail und Nachricht ausfüllen.' });
    if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
    if (datenschutz !== true) return res.status(400).json({ error: 'Bitte stimmen Sie der Datenschutzerklärung zu.' });

    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    const nm = String(name).slice(0, 200);
    const em = String(email).slice(0, 200);
    const tel = telefon ? String(telefon).slice(0, 60) : null;
    const msg = String(nachricht).slice(0, 5000);

    await query('INSERT INTO kontakt_anfragen (name, email, telefon, nachricht, ip) VALUES ($1,$2,$3,$4,$5)', [nm, em, tel, msg, ip]);

    // Benachrichtigung an die Firma (Fehler hier darf die gespeicherte Anfrage nicht verlieren)
    try {
      const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
      const ziel = einst.email || process.env.SMTP_USER;
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      const html = portalMailHtml(einst, {
        titel: 'Neue Kontaktanfrage über die Website',
        absaetze: [
          '<strong>Name:</strong> ' + esc(nm),
          '<strong>E-Mail:</strong> ' + esc(em),
          tel ? '<strong>Telefon:</strong> ' + esc(tel) : '',
          '<strong>Nachricht:</strong><br>' + esc(msg).replace(/\n/g, '<br>')
        ].filter(Boolean),
        hinweis: 'Eingegangen über das Kontaktformular auf www.schroeder-scholz.de. Antworten Sie einfach auf diese E-Mail, um dem Absender zu antworten.'
      });
      await transporter.sendMail({
        from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>',
        to: ziel, replyTo: em,
        subject: 'Kontaktanfrage von ' + nm, html
      });
    } catch (mailErr) { console.error('[Kontakt-Mail]', mailErr.message); }

    res.json({ message: 'ok' });
  } catch (e) { next(e); }
});

module.exports = router;
