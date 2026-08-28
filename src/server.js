'use strict';
require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const cron        = require('node-cron');

const { testConnection } = require('./db/index');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://161.97.187.239'],
  credentials: true,
}));
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Zu viele Anfragen.' }
}));
app.use('/api/auth/login', rateLimit({
  windowMs: 900000, max: 50,
  skipSuccessfulRequests: true, // nur fehlgeschlagene Logins zaehlen (Brute-Force-Schutz), erfolgreiche nicht
  message: { error: 'Zu viele fehlgeschlagene Login-Versuche. Bitte in 15 Minuten erneut versuchen.' }
}));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined'));

app.get('/health', function(req, res) {
  res.json({ status: 'ok', zeit: new Date().toISOString(), version: '1.3.0' });
});

app.use('/api/auth',                       require('./routes/auth'));
app.use('/api/users',                      require('./routes/users'));
app.use('/api/kunden',                     require('./routes/kunden'));
app.use('/api/einlagerungen',              require('./routes/einlagerungen'));
app.use('/api/einstellungen',              require('./routes/einstellungen'));
app.use('/api/dsgvo',                      require('./routes/dsgvo'));
app.use('/api/lager',                      require('./routes/lager'));
app.use('/api/artikel',                    require('./routes/artikel'));
app.use('/api/kunden/:kundenId/dokumente', require('./routes/dokumente'));
app.use('/api/portal/auth',  require('./routes/portal-auth'));
app.use('/api/portal/daten', require('./routes/portal-daten'));
app.use('/api/termine',      require('./routes/termine'));
app.use('/api/aktivitaet',   require('./routes/aktivitaet'));
app.use('/api/homepage',    require('./routes/homepage'));
app.use('/api/kontakt',     require('./routes/kontakt'));
app.use('/api/gutscheine',  require('./routes/gutscheine'));
app.use('/api/gast',        require('./routes/gast'));
app.use('/api/adresse',     require('./routes/adresse'));
app.use('/api/preise',      require('./routes/preise'));
app.use('/api/gewerbe',     require('./routes/gewerbe'));
app.use('/api/qr',          require('./routes/qr'));
app.use('/api/protokolle',  require('./routes/protokolle'));
app.use('/api/rechnungen',                require('./routes/rechnungen'));

app.use(notFound);
app.use(errorHandler);

// ── CRON JOBS ──
// Taeglich 02:00 — abgelaufene Tokens loeschen
cron.schedule('0 2 * * *', async function() {
  try {
    const { query } = require('./db/index');
    const r = await query('DELETE FROM refresh_tokens WHERE ablauf_am < NOW()');
    const p = await query('DELETE FROM passwort_reset_tokens WHERE ablauf_am < NOW()');
    console.log('[Cron 02:00] Tokens geloescht:', r.rowCount + p.rowCount);
  } catch (err) { console.error('[Cron]', err.message); }
}, { timezone: 'Europe/Berlin' });

// Taeglich 03:15 — Website neu erzeugen. Die Seite ist statisch; ohne diesen Lauf
// bliebe ein bereits vergangener Feiertag im Block „Feiertage & besondere Tage“ stehen,
// bis zufaellig jemand im CMS etwas aendert.
cron.schedule('15 3 * * *', async function() {
  try {
    await require('./lib/homepage-generate').regenerate();
    console.log('[Cron 03:15] Website neu erzeugt');
  } catch (err) { console.error('[Cron]', err.message); }
}, { timezone: 'Europe/Berlin' });

// Taeglich 16:00 — Tagesliste fuer morgen per E-Mail
cron.schedule('0 16 * * *', async function() {
  try {
    const { query } = require('./db/index');
    const nodemailer = require('nodemailer');
    const einst = await query('SELECT * FROM einstellungen LIMIT 1');
    if (!einst.rows.length) return;
    const f = einst.rows[0];
    if (!f.email || !process.env.SMTP_HOST) return;

    const morgen = new Date(Date.now() + 24 * 3600 * 1000);
    const morgenStr = morgen.toLocaleDateString('de-DE', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone: 'Europe/Berlin' });
    const morgenDate = morgen.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });

    // Alle aktiven Einlagerungen je Termin aggregiert (kein Duplizieren, kein Verlust bei Status Abholbereit),
    // anonyme Gast-Termine (ohne kunden_id) inklusive, stornierte ausgeschlossen.
    const termine = await query(
      `SELECT t.*,
              COALESCE(NULLIF(TRIM(COALESCE(k.vorname,'')||' '||COALESCE(k.nachname,'')),''), t.kontakt_name) AS kundenname,
              COALESCE(k.kennzeichen, t.kennzeichen) AS kz,
              k.fahrzeug_marke, k.fahrzeug_modell,
              agg.reifen, agg.plaetze
       FROM termine t
       LEFT JOIN kunden k ON t.kunden_id = k.id
       LEFT JOIN LATERAL (
         SELECT string_agg(DISTINCT e.lagerplatz, ', ') AS plaetze,
                string_agg(DISTINCT e.reifen_groesse || ' (' || e.reifen_typ || ')', ', ') AS reifen
         FROM einlagerungen e WHERE e.kunden_id = t.kunden_id AND e.status <> 'Abgeholt'
       ) agg ON true
       WHERE t.datum = $1 AND t.status NOT IN ('storniert','abgesagt')
       ORDER BY t.uhrzeit_von`,
      [morgenDate]
    );

    if (!termine.rows.length) {
      console.log('[Cron 16:00] Keine Termine fuer morgen.');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const esc = function(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    const zeilen = termine.rows.map(function(t, i) {
      return '<tr style="' + (i%2===0?'background:#f9f9f9':'') + '">' +
        '<td style="padding:8px;border:1px solid #ddd">' + (i+1) + '</td>' +
        '<td style="padding:8px;border:1px solid #ddd"><strong>' + esc(t.kundenname||'—') + '</strong></td>' +
        '<td style="padding:8px;border:1px solid #ddd;font-family:monospace">' + esc(t.kz||'—') + '</td>' +
        '<td style="padding:8px;border:1px solid #ddd">' + esc((t.fahrzeug_marke||'') + ' ' + (t.fahrzeug_modell||'')) + '</td>' +
        '<td style="padding:8px;border:1px solid #ddd">' + esc(t.reifen||'—') + '</td>' +
        '<td style="padding:8px;border:1px solid #ddd;font-weight:700;color:#e8502a">' + esc(t.plaetze||'—') + '</td>' +
        '<td style="padding:8px;border:1px solid #ddd">' + esc(t.bemerkungen||'') + '</td>' +
        '</tr>';
    }).join('');

    await transporter.sendMail({
      from: '"' + (f.firmenname||'ReifenPro') + '" <' + process.env.SMTP_USER + '>',
      to: f.email,
      subject: 'Tagesliste fuer ' + morgenStr + ' (' + termine.rows.length + ' Termine)',
      html: '<h2 style="color:#1a3a6e">' + (f.firmenname||'ReifenPro') + '</h2>' +
        '<h3>Tagesliste Werkstatt — ' + morgenStr + '</h3>' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead><tr style="background:#1a3a6e;color:#fff">' +
        '<th style="padding:8px">#</th><th style="padding:8px">Kunde</th>' +
        '<th style="padding:8px">KZ</th><th style="padding:8px">Fahrzeug</th>' +
        '<th style="padding:8px">Reifen</th><th style="padding:8px">Lagerplatz</th>' +
        '<th style="padding:8px">Hinweis</th></tr></thead><tbody>' +
        zeilen + '</tbody></table>' +
        '<p style="color:#888;font-size:12px;margin-top:20px">Automatisch generiert von ReifenPro um 16:00 Uhr</p>',
    });
    console.log('[Cron 16:00] Tagesliste gesendet:', termine.rows.length, 'Termine');
  } catch (err) { console.error('[Cron 16:00]', err.message); }
}, { timezone: 'Europe/Berlin' });

// HU-Erinnerungen laufen ueber cron-erinnerungen.js (crontab 08:00) auf Basis von fahrzeuge.hu_datum.
// Der fruehere 09:00-Job hier nutzte kunden.hu_datum (seit dem Fuhrpark-Umbau ungenutzt) und wurde entfernt,
// um Doppelsysteme/Doppelversand zu vermeiden.

const start = async function() {
  const ok = await testConnection();
  if (!ok) { console.error('[Server] DB-Fehler.'); process.exit(1); }
  app.listen(PORT, '0.0.0.0', function() {
    console.log('[Server] ReifenPro v1.3 laeuft auf Port ' + PORT);
  });
};

start();
