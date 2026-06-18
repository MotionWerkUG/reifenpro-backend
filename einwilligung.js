'use strict';
// Double-Opt-in fuer die Werbe-/Saison-Einwilligung. Liegt auf dem Server unter src/lib/einwilligung.js
// Eine Einwilligung gilt erst als wirksam, wenn der Kunde den Bestaetigungslink angeklickt hat
// (einwilligung_saison_bestaetigt = true). Der Versand-Cron beruecksichtigt nur bestaetigte Einwilligungen.
const crypto = require('crypto');
const { query } = require('../db/index');
const { portalMailHtml, anredeGruss } = require('./mail-template');

function neuerToken() { return crypto.randomBytes(24).toString('hex'); }

function basisUrl(einst) {
  var w = einst && einst.website ? String(einst.website).trim().replace(/\/+$/, '') : '';
  return /^https?:\/\//.test(w) ? w : 'https://www.schroeder-scholz.de';
}

// Setzt einen frischen Token und verschickt die Double-Opt-in-Bestaetigungsmail.
// kunde: { id, vorname, nachname, anrede, email | portal_email }
async function sendeDoi(kunde, einst) {
  const mail = kunde.email || kunde.portal_email;
  if (!mail) return false;
  const token = neuerToken();
  await query("UPDATE kunden SET einwilligung_token=$1, einwilligung_token_ablauf=NOW()+INTERVAL '30 days' WHERE id=$2", [token, kunde.id]);
  const url = basisUrl(einst) + '/api/gast/einwilligung/bestaetigen?token=' + token;
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await transporter.sendMail({
    from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>',
    to: mail,
    subject: 'Bitte bestätigen: Saison-Erinnerungen von Schröder & Scholz',
    html: portalMailHtml(einst || {}, {
      titel: 'Bitte bestätigen Sie Ihre Einwilligung',
      gruss: anredeGruss(kunde.anrede, kunde.vorname, kunde.nachname),
      absaetze: [
        'Sie möchten von uns per E-Mail an den saisonalen Räderwechsel erinnert werden. Damit wir Ihnen Erinnerungen senden dürfen, bestätigen Sie dies bitte einmalig mit einem Klick:'
      ],
      button: { text: 'Einwilligung bestätigen', url: url },
      hinweis: 'Ohne Bestätigung senden wir Ihnen keine Erinnerungen. Falls Sie das nicht angefordert haben, ignorieren Sie diese E-Mail einfach. Sie können die Einwilligung jederzeit widerrufen.'
    })
  });
  return true;
}

module.exports = { neuerToken, sendeDoi, basisUrl };
