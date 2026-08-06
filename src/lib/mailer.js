'use strict';
// Zentraler Mailversand mit Protokollierung in email_log (Audit-Trail fuer versendete Mails).
// Liegt auf dem Server unter src/lib/mailer.js
const nodemailer = require('nodemailer');
const { query } = require('../db/index');

async function logMail(empf, betreff, typ, status, fehler, bezugId) {
  try {
    await query(
      'INSERT INTO email_log (empfaenger, betreff, typ, status, fehler_msg, bezug_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [empf || null, betreff || null, typ || 'system', status, fehler || null, bezugId || null]);
  } catch (e) { console.error('[email_log]', e.message); }
}

// Sendet eine Mail und protokolliert Erfolg/Fehler. Wirft bei Fehler weiter (Aufrufer entscheidet).
async function sendMail({ to, subject, html, attachments, typ, bezugId }) {
  const einst = (await query('SELECT firmenname FROM einstellungen LIMIT 1')).rows[0] || {};
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  try {
    const info = await transporter.sendMail({
      from: '"' + (einst.firmenname || 'Schröder & Scholz') + '" <' + process.env.SMTP_USER + '>',
      to, subject, html, attachments
    });
    await logMail(to, subject, typ, 'ok', null, bezugId);
    return info;
  } catch (e) {
    await logMail(to, subject, typ, 'fehler', e.message, bezugId);
    throw e;
  }
}

module.exports = { sendMail, logMail };
