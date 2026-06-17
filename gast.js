'use strict';
// Oeffentliche Gaeste-Terminbuchung (ohne Kundenkonto), z.B. von der Homepage.
// Liegt auf dem Server unter src/routes/gast.js. Gemountet (oeffentlich) als /api/gast.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { query, withTransaction } = require('../db/index');
const { portalMailHtml } = require('../lib/mail-template');

const limiter = rateLimit({ windowMs: 900000, max: 8, message: { error: 'Zu viele Anfragen. Bitte später erneut versuchen.' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function zeitZuMin(z) { if (!z) return 0; const s = String(z).substring(0, 5); const p = s.split(':').map(Number); return p[0] * 60 + (p[1] || 0); }
function minZuZeit(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
function getBayernFeiertage(jahr) {
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d2 = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h2 = (19 * a + b - d2 - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h2 - k) % 7;
  const m2 = Math.floor((a + 11 * h2 + 22 * l) / 451);
  const monat = Math.floor((h2 + l - 7 * m2 + 114) / 31);
  const tag = ((h2 + l - 7 * m2 + 114) % 31) + 1;
  const ostern = new Date(jahr, monat - 1, tag);
  const fmt = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  const add = (x, t) => { const n = new Date(x); n.setDate(n.getDate() + t); return fmt(n); };
  return [jahr + '-01-01', jahr + '-01-06', add(ostern, -2), add(ostern, 1), jahr + '-05-01', add(ostern, 39), add(ostern, 50), add(ostern, 60), jahr + '-08-15', jahr + '-10-03', jahr + '-11-01', jahr + '-12-25', jahr + '-12-26'];
}
function isFeiertag(datumStr) {
  const m = String(datumStr).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return false;
  return getBayernFeiertage(parseInt(m[1])).includes(m[1] + '-' + m[2] + '-' + m[3]);
}
function wochentagVon(datumStr) { const m = String(datumStr).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return 1; return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])).getDay(); }

async function oeffnungUndDauer(datum, artikel_id) {
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0];
  if (!einst) return { fehler: 'Einstellungen fehlen' };
  const art = (await query('SELECT * FROM artikel WHERE id=$1 AND aktiv IS NOT false', [artikel_id])).rows[0];
  if (!art) return { fehler: 'Leistung nicht gefunden' };
  const dauer = art.dauer_minuten || 30;
  const urlaub = await query('SELECT id FROM betriebsurlaub WHERE von_datum <= $1 AND bis_datum >= $1', [datum]);
  if (urlaub.rows.length) return { grund: 'Betriebsurlaub', dauer, art };
  if (isFeiertag(datum)) return { grund: 'Feiertag', dauer, art };
  const wt = wochentagVon(datum);
  let vonStr, bisStr;
  if (wt === 0) { if (!einst.so_offen) return { grund: 'Geschlossen', dauer, art }; vonStr = einst.so_von; bisStr = einst.so_bis; }
  else if (wt === 6) { if (!einst.sa_offen) return { grund: 'Geschlossen', dauer, art }; vonStr = einst.sa_von; bisStr = einst.sa_bis; }
  else { vonStr = einst.mo_fr_von || '08:00'; bisStr = einst.mo_fr_bis || '18:00'; }
  return { einst, art, dauer, vonStr, bisStr };
}

async function freieSlots(datum, artikel_id) {
  const o = await oeffnungUndDauer(datum, artikel_id);
  if (o.fehler) return { error: o.fehler };
  if (o.grund) return { slots: [], grund: o.grund };
  const einst = o.einst, dauer = o.dauer;
  const mpVon = einst.mittagspause_von, mpBis = einst.mittagspause_bis;
  const maxParallel = einst.max_parallele_termine || 1;
  const gebuchte = (await query("SELECT uhrzeit_von, uhrzeit_bis FROM termine WHERE datum=$1 AND status NOT IN ('storniert','abgesagt')", [datum])).rows;
  const slots = [];
  const vonMin = zeitZuMin(o.vonStr), bisMin = zeitZuMin(o.bisStr);
  for (let start = vonMin; start + dauer <= bisMin; start += 15) {
    const ende = start + dauer;
    if (mpVon && mpBis) { const a = zeitZuMin(mpVon), b = zeitZuMin(mpBis); if (start < b && ende > a) continue; }
    const ueber = gebuchte.filter(t => start < zeitZuMin(t.uhrzeit_bis) && ende > zeitZuMin(t.uhrzeit_von)).length;
    if (ueber < maxParallel) slots.push({ von: minZuZeit(start), bis: minZuZeit(ende) });
  }
  return { slots, dauer, artikel: o.art.name };
}

// Buchbare Leistungen
router.get('/artikel', limiter, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT id, name, dauer_minuten FROM artikel WHERE aktiv IS NOT false AND dauer_minuten IS NOT NULL AND dauer_minuten > 0 ORDER BY sortierung, name");
    res.json(rows);
  } catch (e) { next(e); }
});

// Freie Slots
router.get('/slots', limiter, async (req, res, next) => {
  try {
    const { datum, artikel_id } = req.query;
    if (!datum || !artikel_id) return res.status(400).json({ error: 'datum und artikel_id erforderlich' });
    const r = await freieSlots(datum, artikel_id);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (e) { next(e); }
});

// Termin buchen (Gast) – sofort bestaetigt
router.post('/termin', limiter, async (req, res, next) => {
  try {
    const { name, telefon, email, kennzeichen, datum, uhrzeit_von, artikel_id, datenschutz, website } = req.body || {};
    if (website) return res.json({ message: 'ok' }); // Honeypot
    if (!name || !telefon || !email || !kennzeichen || !datum || !uhrzeit_von || !artikel_id)
      return res.status(400).json({ error: 'Bitte alle Pflichtfelder ausfüllen.' });
    if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
    if (datenschutz !== true) return res.status(400).json({ error: 'Bitte stimmen Sie der Datenschutzerklärung zu.' });

    const o = await oeffnungUndDauer(datum, artikel_id);
    if (o.fehler) return res.status(400).json({ error: o.fehler });
    if (o.grund) return res.status(409).json({ error: 'An diesem Tag ist keine Buchung möglich (' + o.grund + ').' });
    const dauer = o.dauer;
    const uhrzeit_bis = minZuZeit(zeitZuMin(uhrzeit_von) + dauer);
    const maxParallel = o.einst.max_parallele_termine || 1;
    const nm = String(name).slice(0, 120), tel = String(telefon).slice(0, 60), em = String(email).slice(0, 160);
    const kz = String(kennzeichen).slice(0, 20);

    // Verfuegbarkeit + Insert in Transaktion mit Tages-Lock (gegen Doppelbuchung)
    const termin = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['termin:' + datum]);
      const konflikt = await client.query(
        "SELECT COUNT(*) FROM termine WHERE datum=$1 AND status NOT IN ('storniert','abgesagt') AND uhrzeit_von < $3 AND uhrzeit_bis > $2",
        [datum, uhrzeit_von, uhrzeit_bis]);
      if (parseInt(konflikt.rows[0].count) >= maxParallel) { const e = new Error('Dieser Termin ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen.'); e.status = 409; throw e; }
      const ins = await client.query(
        `INSERT INTO termine (kontakt_name, kontakt_telefon, kontakt_email, datum, uhrzeit_von, uhrzeit_bis, termin_typ, kennzeichen, artikel_id, status, portal_buchung)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'bestaetigt',true) RETURNING *`,
        [nm, tel, em, datum, uhrzeit_von, uhrzeit_bis, o.art.name, kz, artikel_id]);
      return ins.rows[0];
    });

    // Mails (Fehler hier darf die Buchung nicht abbrechen)
    try {
      const einst = o.einst;
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      const dF = datum.split('-').reverse().join('.');
      const vorname = nm.split(' ')[0];
      const htmlGast = portalMailHtml(einst, {
        titel: 'Ihr Termin ist bestätigt', name: vorname,
        absaetze: [
          'vielen Dank für Ihre Terminbuchung bei Schröder &amp; Scholz.',
          '<strong>Datum:</strong> ' + dF + '<br><strong>Uhrzeit:</strong> ' + uhrzeit_von + ' Uhr<br><strong>Leistung:</strong> ' + o.art.name + '<br><strong>Kennzeichen:</strong> ' + kz
        ],
        hinweis: 'Bei Fragen erreichen Sie uns' + (einst.telefon ? ' unter ' + einst.telefon : '') + '. Falls Sie den Termin nicht wahrnehmen können, sagen Sie uns bitte rechtzeitig Bescheid.'
      });
      await transporter.sendMail({ from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: em, replyTo: einst.email || process.env.SMTP_USER, subject: 'Terminbestätigung ' + dF + ' ' + uhrzeit_von + ' Uhr — Schröder & Scholz', html: htmlGast });
      if (einst.email) {
        await transporter.sendMail({ from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: einst.email, replyTo: em,
          subject: 'Neue Online-Terminbuchung (Gast): ' + o.art.name + ' am ' + dF + ' ' + uhrzeit_von,
          html: '<p><strong>Neue Gäste-Buchung über die Homepage:</strong></p><p>Name: ' + nm + '<br>Telefon: ' + tel + '<br>E-Mail: ' + em + '<br>Kennzeichen: ' + kz + '<br>Leistung: ' + o.art.name + '<br>Datum: ' + dF + ' ' + uhrzeit_von + ' Uhr</p>' });
      }
    } catch (mailErr) { console.error('[Gast-Buchung-Mail]', mailErr.message); }

    res.status(201).json({ message: 'ok', datum: datum, uhrzeit_von: uhrzeit_von, leistung: o.art.name });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

module.exports = router;
