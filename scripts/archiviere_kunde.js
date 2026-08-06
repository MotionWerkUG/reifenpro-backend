'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs        = require('fs');
const path      = require('path');
const nodemailer = require('nodemailer');
const { pool }  = require('../src/db/index');

const ARCHIV_DIR = path.join(
  process.env.BACKUP_DIR || '/var/backups/reifenpro',
  'kunden_archiv'
);

async function main() {
  const kundenId = process.argv[2];
  if (!kundenId) {
    console.error('Verwendung: node archiviere_kunde.js <kunden-uuid>');
    process.exit(1);
  }

  if (!fs.existsSync(ARCHIV_DIR)) {
    fs.mkdirSync(ARCHIV_DIR, { recursive: true });
  }

  const client = await pool.connect();
  try {
    const results = await Promise.all([
      client.query('SELECT * FROM kunden WHERE id=$1', [kundenId]),
      client.query('SELECT * FROM einlagerungen WHERE kunden_id=$1', [kundenId]),
      client.query('SELECT id,typ,titel,erstellt_am,unterschrift_datum FROM kunden_dokumente WHERE kunden_id=$1', [kundenId]),
      client.query('SELECT * FROM termine WHERE kunden_id=$1', [kundenId]),
    ]);

    var k    = results[0];
    var einl = results[1];
    var docs = results[2];
    var term = results[3];

    if (!k.rows.length) {
      console.error('[Archiv] Kunde nicht gefunden:', kundenId);
      process.exit(1);
    }

    var kunde = Object.assign({}, k.rows[0]);
    delete kunde.portal_password;

    var loeschDatum = new Date(Date.now() + 8 * 365 * 24 * 60 * 60 * 1000)
      .toLocaleDateString('de-DE');

    var archivDaten = {
      archiviert_am:        new Date().toISOString(),
      grund:                'Konto-Loeschung durch Kunde oder Admin',
      aufbewahrungspflicht: '8 Jahre gemaess § 257 HGB (BEG IV ab 01.01.2025)',
      loeschung_ab:         loeschDatum,
      kunde:                kunde,
      einlagerungen:        einl.rows,
      dokumente:            docs.rows,
      termine:              term.rows,
    };

    var dateiname = 'kunde_' + kunde.kunden_nr + '_' +
      new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
    var dateipfad = path.join(ARCHIV_DIR, dateiname);

    fs.writeFileSync(dateipfad, JSON.stringify(archivDaten, null, 2), 'utf8');
    console.log('[Archiv] Gespeichert: ' + dateipfad);

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      var transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from:    '"ReifenPro Archiv" <' + process.env.SMTP_USER + '>',
        to:      process.env.SMTP_USER,
        subject: 'Kundenkonto archiviert: ' + kunde.kunden_nr + ' - ' + kunde.vorname + ' ' + kunde.nachname,
        html:
          '<h2>Kundenkonto-Archivierung</h2>' +
          '<p>Ein Kundenkonto wurde geloescht und archiviert.</p>' +
          '<table style="border-collapse:collapse;width:100%;font-size:13px">' +
            '<tr><td style="padding:6px;border:1px solid #ddd;color:#666">Kunden-Nr.</td>' +
                '<td style="padding:6px;border:1px solid #ddd"><strong>' + kunde.kunden_nr + '</strong></td></tr>' +
            '<tr><td style="padding:6px;border:1px solid #ddd;color:#666">Name</td>' +
                '<td style="padding:6px;border:1px solid #ddd">' + kunde.vorname + ' ' + kunde.nachname + '</td></tr>' +
            '<tr><td style="padding:6px;border:1px solid #ddd;color:#666">Einlagerungen</td>' +
                '<td style="padding:6px;border:1px solid #ddd">' + einl.rows.length + ' gesamt</td></tr>' +
            '<tr><td style="padding:6px;border:1px solid #ddd;color:#666">Aufbewahrung bis</td>' +
                '<td style="padding:6px;border:1px solid #ddd"><strong>' + loeschDatum + '</strong> (8 Jahre § 257 HGB)</td></tr>' +
          '</table>' +
          '<p>Archivdatei auf Server: <code>' + dateipfad + '</code></p>',
        attachments: [{
          filename: dateiname,
          path:     dateipfad,
        }],
      });
      console.log('[Archiv] E-Mail gesendet.');
    }

    console.log('[Archiv] Fertig.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(function(err) {
  console.error('[Archiv] Fehler:', err.message);
  process.exit(1);
});
