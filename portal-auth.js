'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../db/index');
const { portalMailHtml } = require('../lib/mail-template');

// ── Middleware: Kunde authentifizieren ──
async function authKunde(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    const payload = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    if (payload.typ !== 'kunde') return res.status(401).json({ error: 'Kein Kunden-Token' });
    const { rows } = await query('SELECT * FROM kunden WHERE id=$1 AND portal_aktiv=true AND portal_freigegeben=true', [payload.id]);
    if (!rows.length) return res.status(401).json({ error: 'Konto gesperrt oder nicht freigegeben' });
    req.kunde = rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token ungültig' });
  }
}
module.exports.authKunde = authKunde;

// ── Mailer Helper ──
async function sendMail(to, subject, html) {
  const nodemailer = require('nodemailer');
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>',
    to, subject, html
  });
}

// ── POST /api/portal/auth/registrieren ──
router.post('/registrieren', async (req, res, next) => {
  try {
    const { vorname, nachname, email, passwort, telefon, agb, dsgvo, saison } = req.body;
    if (!vorname || !nachname || !email || !passwort) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
    if (!agb || !dsgvo) return res.status(400).json({ error: 'AGB und Datenschutz müssen akzeptiert werden' });
    if (passwort.length < 8) return res.status(400).json({ error: 'Passwort muss mind. 8 Zeichen haben' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-Mail ungültig' });

    // Prüfe ob E-Mail bereits als Portal-Account existiert (case-insensitiv)
    const existiert = await query('SELECT id FROM kunden WHERE LOWER(portal_email)=$1', [email.toLowerCase()]);
    if (existiert.rows.length) return res.status(400).json({ error: 'Diese E-Mail ist bereits registriert' });

    // Prüfe ob Kunde bereits in DB (über normale E-Mail, case-insensitiv) -> verknüpfen statt duplizieren
    const bestandskunde = await query('SELECT id FROM kunden WHERE LOWER(email)=$1 AND aktiv=true', [email.toLowerCase()]);

    const hash = await bcrypt.hash(passwort, 12);
    const token = crypto.randomBytes(32).toString('hex');
    const ablauf = new Date(Date.now() + 24 * 3600000);
    const now = new Date();
    // Nachweis der Einwilligung: IP (via nginx-Header) + Stand der akzeptierten Dokumente
    const einwilligungIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;
    const agbVersion = 'Stand ' + now.toISOString().substring(0, 10);

    let kundeId;
    if (bestandskunde.rows.length) {
      // Bestandskunde: Portal-Daten ergänzen
      kundeId = bestandskunde.rows[0].id;
      await query(
        `UPDATE kunden SET portal_email=$1, portal_password=$2, portal_aktiv=true,
         portal_freigegeben=false, portal_email_bestaetigt=false,
         portal_bestaetigung_token=$3, portal_token_ablauf=$4,
         portal_registriert_am=$5, portal_agb_akzeptiert=$6, portal_agb_datum=$5,
         portal_dsgvo_akzeptiert=$6, portal_dsgvo_datum=$5,
         einwilligung_saison_erinnerung=$7, einwilligung_ip=$9, agb_version=$10
         WHERE id=$8`,
        [email.toLowerCase(), hash, token, ablauf, now, true, saison ? true : false, kundeId, einwilligungIp, agbVersion]
      );
    } else {
      // Neuer Kunde anlegen (Kundennummer aus Sequenz wie im Admin -> keine Doppelnummern)
      const nr = 'K-' + String((await query("SELECT nextval('seq_kunden_nr') AS n")).rows[0].n).padStart(4, '0');
      const neu = await query(
        `INSERT INTO kunden (kunden_nr, vorname, nachname, email, telefon,
         portal_email, portal_password, portal_aktiv, portal_freigegeben,
         portal_email_bestaetigt, portal_bestaetigung_token, portal_token_ablauf,
         portal_registriert_am, portal_agb_akzeptiert, portal_agb_datum,
         portal_dsgvo_akzeptiert, portal_dsgvo_datum, einwilligung_saison_erinnerung,
         einwilligung_ip, agb_version, aktiv)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,false,false,$8,$9,$10,true,$10,true,$10,$11,$12,$13,true)
         RETURNING id`,
        [nr, vorname, nachname, email.toLowerCase(), telefon || null,
         email.toLowerCase(), hash, token, ablauf, now, saison ? true : false, einwilligungIp, agbVersion]
      );
      kundeId = neu.rows[0].id;
    }

    // Bestätigungs-E-Mail senden
    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    const portalUrl = einst.portal_url || 'http://161.97.187.239/reifenpro/portal/';
    const link = portalUrl + '?bestaetigen=' + token;
    await sendMail(
      email,
      'Bitte bestätigen Sie Ihre E-Mail — Schröder & Scholz',
      portalMailHtml(einst, {
        titel: 'Willkommen im Kundenportal',
        name: vorname,
        absaetze: [
          'vielen Dank für Ihre Registrierung im Kundenportal von Schröder &amp; Scholz.',
          'Bitte bestätigen Sie Ihre E-Mail-Adresse mit einem Klick auf den folgenden Button. Anschließend prüfen wir Ihren Zugang und schalten ihn frei — danach können Sie Ihre eingelagerten Räder einsehen und Termine bequem online buchen.'
        ],
        button: { text: 'E-Mail bestätigen', url: link },
        hinweis: 'Der Bestätigungslink ist 24 Stunden gültig. Falls Sie sich nicht registriert haben, können Sie diese E-Mail ignorieren.'
      })
    );

    // Admin informieren
    if (einst.email) {
      await sendMail(
        einst.email,
        'Neue Portal-Registrierung: ' + vorname + ' ' + nachname,
        '<p>Ein neuer Kunde hat sich im Portal registriert:</p>' +
        '<p><strong>' + vorname + ' ' + nachname + '</strong><br>' +
        'E-Mail: ' + email + '<br>' +
        (telefon ? 'Telefon: ' + telefon + '<br>' : '') +
        (bestandskunde.rows.length ? 'Bestandskunde — Portal-Zugang beantragt' : 'Neuer Kunde') + '</p>' +
        '<p>Bitte im Admin-Bereich unter Kunden freigeben.</p>'
      ).catch(() => {});
    }

    res.json({ message: 'Registrierung erfolgreich. Bitte E-Mail bestätigen.' });
  } catch (e) { next(e); }
});

// ── GET /api/portal/auth/bestaetigen/:token ──
router.get('/bestaetigen/:token', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, vorname FROM kunden WHERE portal_bestaetigung_token=$1 AND portal_token_ablauf > NOW()',
      [req.params.token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Token ungültig oder abgelaufen' });
    await query(
      'UPDATE kunden SET portal_email_bestaetigt=true, portal_bestaetigung_token=null WHERE id=$1',
      [rows[0].id]
    );
    res.json({ message: 'E-Mail bestätigt. Ihr Konto wird in Kürze freigeschaltet.', vorname: rows[0].vorname });
  } catch (e) { next(e); }
});

// ── POST /api/portal/auth/login ──
router.post('/login', async (req, res, next) => {
  try {
    const { email, passwort } = req.body;
    if (!email || !passwort) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
    const { rows } = await query('SELECT * FROM kunden WHERE portal_email=$1 AND portal_aktiv=true', [email.toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
    const k = rows[0];
    if (!k.portal_email_bestaetigt) return res.status(401).json({ error: 'E-Mail noch nicht bestätigt. Bitte prüfen Sie Ihr Postfach.' });
    if (!k.portal_freigegeben) return res.status(401).json({ error: 'Ihr Konto wurde noch nicht freigeschaltet. Wir melden uns in Kürze.' });
    const ok = await bcrypt.compare(passwort, k.portal_password);
    if (!ok) return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
    const token = jwt.sign({ id: k.id, typ: 'kunde' }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({
      token,
      kunde: { id: k.id, vorname: k.vorname, nachname: k.nachname, email: k.portal_email, kennzeichen: k.kennzeichen, fahrzeug_marke: k.fahrzeug_marke, fahrzeug_modell: k.fahrzeug_modell, hu_datum: k.hu_datum }
    });
  } catch (e) { next(e); }
});

// ── POST /api/portal/auth/passwort-vergessen ──
router.post('/passwort-vergessen', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ message: 'ok' });
    const { rows } = await query('SELECT * FROM kunden WHERE portal_email=$1 AND portal_aktiv=true', [email.toLowerCase()]);
    if (!rows.length) return res.json({ message: 'ok' });
    const k = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const ablauf = new Date(Date.now() + 3600000);
    await query('UPDATE kunden SET portal_bestaetigung_token=$1, portal_token_ablauf=$2 WHERE id=$3', [token, ablauf, k.id]);
    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    const portalUrl = einst.portal_url || 'http://161.97.187.239/reifenpro/portal/';
    await sendMail(
      k.portal_email,
      'Passwort zurücksetzen — ' + (einst.firmenname || 'ReifenPro'),
      '<p>Hallo ' + k.vorname + ',</p><p>Klicken Sie auf den Link um Ihr Passwort zurückzusetzen:</p>' +
      '<p><a href="' + portalUrl + '?reset=' + token + '">Passwort zurücksetzen</a></p><p>Der Link ist 1 Stunde gültig.</p>'
    ).catch(() => {});
    res.json({ message: 'ok' });
  } catch (e) { next(e); }
});

// ── POST /api/portal/auth/passwort-reset ──
router.post('/passwort-reset', async (req, res, next) => {
  try {
    const { token, passwort } = req.body;
    if (!token || !passwort || passwort.length < 8) return res.status(400).json({ error: 'Ungültige Daten' });
    const { rows } = await query('SELECT id FROM kunden WHERE portal_bestaetigung_token=$1 AND portal_token_ablauf > NOW()', [token]);
    if (!rows.length) return res.status(400).json({ error: 'Token ungültig oder abgelaufen' });
    const hash = await bcrypt.hash(passwort, 12);
    await query('UPDATE kunden SET portal_password=$1, portal_bestaetigung_token=null WHERE id=$2', [hash, rows[0].id]);
    res.json({ message: 'Passwort erfolgreich geändert' });
  } catch (e) { next(e); }
});

// ── GET /api/portal/auth/me ──
router.get('/me', authKunde, async (req, res) => {
  const k = req.kunde;
  res.json({ id: k.id, vorname: k.vorname, nachname: k.nachname, email: k.portal_email, telefon: k.telefon, kennzeichen: k.kennzeichen, fahrzeug_marke: k.fahrzeug_marke, fahrzeug_modell: k.fahrzeug_modell, fahrzeug_typ: k.fahrzeug_typ, hu_datum: k.hu_datum, anrede: k.anrede });
});

// ── PUT /api/portal/auth/profil ──
router.put('/profil', authKunde, async (req, res, next) => {
  try {
    const { telefon, kennzeichen, fahrzeug_marke, fahrzeug_modell } = req.body;
    await query('UPDATE kunden SET telefon=$1, kennzeichen=$2, fahrzeug_marke=$3, fahrzeug_modell=$4, geaendert_am=NOW() WHERE id=$5',
      [telefon, kennzeichen, fahrzeug_marke, fahrzeug_modell, req.kunde.id]);
    res.json({ message: 'Profil aktualisiert' });
  } catch (e) { next(e); }
});

// ── POST /api/portal/auth/konto-loeschen ── Loeschauftrag (Art. 17 DSGVO)
router.post('/konto-loeschen', authKunde, async (req, res, next) => {
  try {
    const k = req.kunde;
    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    // Bei aktiver Einlagerung gesetzliche Aufbewahrung -> keine Online-Loeschung
    const aktiv = await query("SELECT COUNT(*)::int AS c FROM einlagerungen WHERE kunden_id=$1 AND status<>'Abgeholt'", [k.id]);
    if (aktiv.rows[0].c > 0) {
      return res.status(409).json({
        code: 'AKTIVE_EINLAGERUNG',
        error: 'Solange Räder bei uns eingelagert sind, ist eine Löschung nicht möglich. Bitte wenden Sie sich an uns' + (einst.telefon ? ' unter ' + einst.telefon : '') + '.'
      });
    }
    await query('UPDATE kunden SET loeschung_beantragt_am=NOW() WHERE id=$1', [k.id]);
    await query("INSERT INTO dsgvo_anfragen (kunden_id, typ, status, nachricht) VALUES ($1,'loeschung','offen',$2)", [k.id, 'Löschauftrag über das Kundenportal']);
    if (einst.email) {
      await sendMail(
        einst.email,
        'Löschauftrag (Art. 17 DSGVO) — ' + k.vorname + ' ' + k.nachname,
        '<p>Ein Kunde hat über das Kundenportal die Löschung seines Kontos beantragt:</p>' +
        '<p><strong>' + k.vorname + ' ' + k.nachname + '</strong><br>E-Mail: ' + (k.portal_email || k.email || '') + '<br>Kunden-Nr.: ' + (k.kunden_nr || '') + '</p>' +
        '<p>Bitte im Admin unter DSGVO-Anfragen bearbeiten (gesetzliche Frist: 1 Monat).</p>'
      ).catch(() => {});
    }
    res.json({ message: 'Löschauftrag eingegangen' });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.authKunde = authKunde;
