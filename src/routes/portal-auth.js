'use strict';
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { query, withTransaction } = require('../db/index');
const { portalMailHtml } = require('../lib/mail-template');
const { authenticate, requireStaff } = require('../middleware/auth');

// Brute-Force-Schutz: fehlgeschlagene Logins begrenzen, Reset-/Vergessen-Mails drosseln
const loginLimiter = rateLimit({
  windowMs: 900000, max: 10, skipSuccessfulRequests: true,
  message: { error: 'Zu viele fehlgeschlagene Login-Versuche. Bitte in 15 Minuten erneut versuchen.' }
});
const resetLimiter = rateLimit({
  windowMs: 3600000, max: 5,
  message: { error: 'Zu viele Anfragen. Bitte später erneut versuchen.' }
});
// Registrierung drosseln (jede Registrierung sendet Bestaetigungs- + Admin-Mail) -> Mail-Bomb-Schutz
const registrierLimiter = rateLimit({
  windowMs: 3600000, max: 10,
  message: { error: 'Zu viele Registrierungen. Bitte später erneut versuchen.' }
});
// Konstanter, gueltiger bcrypt-Hash fuer Timing-Angleich bei unbekannter E-Mail (verhindert User-Enumeration)
const DUMMY_HASH = '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';

// ── Middleware: Kunde authentifizieren ──
async function authKunde(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    const payload = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
    if (payload.typ !== 'kunde') return res.status(401).json({ error: 'Kein Kunden-Token' });
    const { rows } = await query('SELECT * FROM kunden WHERE id=$1 AND portal_aktiv=true AND portal_freigegeben=true', [payload.id]);
    if (!rows.length) return res.status(401).json({ error: 'Konto gesperrt oder nicht freigegeben' });
    // Nach einer Passwortaenderung aeltere Tokens ungueltig machen (5s Toleranz)
    if (rows[0].passwort_geaendert_am && payload.iat && payload.iat * 1000 < new Date(rows[0].passwort_geaendert_am).getTime() - 5000)
      return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte neu anmelden.' });
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

// Leerstring wie NULL behandeln -> COALESCE(NULLIF(...)) greift sauber
function kontaktWert(v) { const x = String(v == null ? '' : v).trim(); return x === '' ? null : x; }

// ── GET /api/portal/auth/konto-start ──
// Vorbefuellung des Registrierungsformulars aus einem bestaetigten Gast-Termin. Adressiert ueber den
// signierten Token aus der Terminbestaetigung, damit in der URL des CTA keine personenbezogenen Daten
// stehen. Gibt bewusst nur zurueck, was ins Formular gehoert -- keine Termin-, Preis- oder Fahrzeugdaten.
router.get('/konto-start', async (req, res, next) => {
  try {
    const t = await gastKontoTermin(req.query.token);
    if (!t) return res.status(400).json({ error: 'Dieser Link ist ungültig oder abgelaufen. Bitte legen Sie Ihr Konto normal an.' });
    res.json({
      vorname: t.kontakt_vorname || '', nachname: t.kontakt_nachname || '',
      email: t.kontakt_email || '', telefon: t.kontakt_telefon || '',
      kundentyp: t.kontakt_kundentyp || 'privat', firma: t.kontakt_firma || ''
    });
  } catch (e) { next(e); }
});

// Prueft den Token aus der Terminbestaetigung und liefert den zugehoerigen Gast-Termin.
// Bedingungen: gueltige Signatur, richtiger Typ, Termin existiert, gehoert noch KEINEM Konto
// (kunden_id IS NULL) und ist bestaetigt -- unbestaetigte Anfragen beweisen nichts.
async function gastKontoTermin(token) {
  let p = null;
  try { p = jwt.verify(token || '', process.env.JWT_SECRET); } catch (e) { p = null; }
  if (!p || p.typ !== 'gast-konto' || !p.tid || !p.email) return null;
  const t = (await query(
    "SELECT * FROM termine WHERE id=$1 AND kunden_id IS NULL AND LOWER(kontakt_email)=$2 AND status IN ('bestaetigt','abgeschlossen')",
    [p.tid, String(p.email).toLowerCase()])).rows[0];
  return t || null;
}

// ── POST /api/portal/auth/registrieren ──
router.post('/registrieren', registrierLimiter, async (req, res, next) => {
  try {
    const { vorname, nachname, email, passwort, telefon, agb, dsgvo, saison, bewertung } = req.body;
    if (!vorname || !nachname || !email || !passwort) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
    if (!agb || !dsgvo) return res.status(400).json({ error: 'AGB und Datenschutz müssen akzeptiert werden' });
    if (passwort.length < 8) return res.status(400).json({ error: 'Passwort muss mind. 8 Zeichen haben' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-Mail ungültig' });

    // Frei eingebbare Felder von HTML-Zeichen befreien (Schutz gegen Injektion in Admin-Mail/-UI)
    const noTag = (s) => String(s == null ? '' : s).replace(/[<>]/g, '');
    const vn = noTag(vorname).slice(0, 80);
    const nn = noTag(nachname).slice(0, 80);
    const tel = telefon ? noTag(telefon).slice(0, 60) : null;
    const emailSafe = noTag(email).slice(0, 160);

    // Passwort-Hash VOR der Existenzpruefung berechnen -> beide Zweige haben denselben teuren
    // CPU-Pfad (bcrypt), damit die Antwortzeit die Konto-Existenz nicht verraet (analog DUMMY_HASH beim Login).
    const hash = await bcrypt.hash(passwort, 12);

    // Prüfe ob E-Mail bereits als Portal-Account existiert (case-insensitiv)
    const existiert = await query('SELECT id FROM kunden WHERE LOWER(portal_email)=$1', [email.toLowerCase()]);
    if (existiert.rows.length) {
      // Anti-Enumeration: KEINE spezifische "bereits registriert"-Meldung. Identische generische
      // Antwort wie bei Neuanlage; der bcrypt.hash oben lief bereits -> gleiche Antwortzeit.
      // Bewusst KEINE Mail (der Angreifer sieht das fremde Postfach nicht -> Mail wuerde nur einen
      // Spam-Vektor an bekannte Adressen eroeffnen). Der Nutzer nutzt bei Bedarf "Passwort vergessen".
      return res.json({ message: 'Registrierung erfolgreich. Bitte E-Mail bestätigen.' });
    }

    // ── Weg aus einer bestaetigten Gast-Buchung: keine zweite Bestaetigung, keine Freischaltung ──
    // Wer den Bestaetigungslink seines Termins angeklickt hat, hat den Besitz des Postfachs bereits
    // bewiesen. Ihn dafuer ein zweites Mal per Mail bestaetigen zu lassen (und dann noch auf die
    // Freischaltung warten zu lassen) ist reine Schikane -- Entscheidung David.
    // Bedingungen, damit das sicher bleibt:
    //  - Nachweis NUR ueber den signierten Token, NIE ueber blosse Uebereinstimmung der Adresse,
    //  - die angegebene E-Mail muss der Adresse im Token entsprechen,
    //  - es darf noch KEIN Portal-Konto auf diese Adresse geben (sonst waere das ein Weg, sich an
    //    ein fremdes bestehendes Konto zu haengen; dann greift unten der normale Ablauf).
    const kontoTermin = req.body.konto_token ? await gastKontoTermin(req.body.konto_token) : null;
    if (kontoTermin && !existiert.rows.length
        && String(kontoTermin.kontakt_email || '').toLowerCase() === email.toLowerCase()) {
      const now2 = new Date();
      const ip2 = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;
      const agbV2 = 'Stand ' + now2.toISOString().substring(0, 10);
      // Anschrift und Kennzeichen aus der Buchung uebernehmen -- genau die Daten, die spaeter fuer
      // die Rechnung gebraucht werden und die der Kunde sonst ein zweites Mal eintippen muesste.
      const kid = await withTransaction(async (client) => {
        // Bestandskunde ohne Portal-Zugang? Dann daran anknuepfen statt einen zweiten Datensatz anzulegen.
        const best = (await client.query(
          'SELECT id FROM kunden WHERE LOWER(email)=$1 AND aktiv=true AND portal_password IS NULL LIMIT 1',
          [email.toLowerCase()])).rows[0];
        let id;
        if (best) {
          id = best.id;
          await client.query(
            `UPDATE kunden SET portal_email=$1, portal_password=$2, portal_aktiv=true,
             portal_freigegeben=true, portal_email_bestaetigt=true,
             portal_bestaetigung_token=NULL, portal_token_ablauf=NULL,
             portal_registriert_am=$3, portal_agb_akzeptiert=true, portal_agb_datum=$3,
             portal_dsgvo_akzeptiert=true, portal_dsgvo_datum=$3,
             einwilligung_saison_erinnerung=$4, einwilligung_ip=$5, agb_version=$6,
             einwilligung_bewertung=$7, einwilligung_bewertung_am=$8,
             telefon=COALESCE(NULLIF(telefon,''), $9), geaendert_am=NOW()
             WHERE id=$10`,
            [email.toLowerCase(), hash, now2, saison ? true : false, ip2, agbV2,
             bewertung ? true : false, bewertung ? now2 : null, tel, id]);
        } else {
          const nr2 = 'K-' + String((await client.query("SELECT nextval('seq_kunden_nr') AS n")).rows[0].n).padStart(4, '0');
          id = (await client.query(
            `INSERT INTO kunden (kunden_nr, vorname, nachname, email, telefon,
             portal_email, portal_password, portal_aktiv, portal_freigegeben,
             portal_email_bestaetigt, portal_registriert_am, portal_agb_akzeptiert, portal_agb_datum,
             portal_dsgvo_akzeptiert, portal_dsgvo_datum, einwilligung_saison_erinnerung,
             einwilligung_ip, agb_version, einwilligung_bewertung, einwilligung_bewertung_am, aktiv)
             VALUES ($1,$2,$3,$4,$5,$6,$7,true,true,true,$8,true,$8,true,$8,$9,$10,$11,$12,$13,true)
             RETURNING id`,
            [nr2, vn, nn, email.toLowerCase(), tel, email.toLowerCase(), hash, now2,
             saison ? true : false, ip2, agbV2, bewertung ? true : false, bewertung ? now2 : null])).rows[0].id;
        }
        // Anschrift/Kennzeichen aus der Buchung nur fuellen, wo im Stamm noch nichts steht --
        // gepflegte Daten des Betriebs duerfen dadurch nicht ueberschrieben werden.
        await client.query(
          `UPDATE kunden SET strasse=COALESCE(NULLIF(strasse,''), $1), plz=COALESCE(NULLIF(plz,''), $2),
           ort=COALESCE(NULLIF(ort,''), $3), kennzeichen=COALESCE(NULLIF(kennzeichen,''), $4), geaendert_am=NOW()
           WHERE id=$5`,
          [kontaktWert(kontoTermin.kontakt_strasse), kontaktWert(kontoTermin.kontakt_plz),
           kontaktWert(kontoTermin.kontakt_ort), kontaktWert(kontoTermin.kennzeichen), id]);
        // Alle noch kontenlosen Termine dieser Adresse ans Konto haengen -- sonst sieht der Kunde
        // seinen gerade gebuchten Termin im Portal ueberhaupt nicht (das Portal liest ueber kunden_id).
        await client.query(
          "UPDATE termine SET kunden_id=$1, geaendert_am=NOW() WHERE kunden_id IS NULL AND LOWER(kontakt_email)=$2",
          [id, email.toLowerCase()]);
        return id;
      });
      // Betrieb informieren (wie beim normalen Weg) -- aber KEINE Bestaetigungsmail an den Kunden.
      const einstK = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
      if (einstK.email) {
        sendMail(einstK.email, 'Neues Kundenkonto (aus Online-Buchung): ' + vn + ' ' + nn,
          '<p>Ein Gast hat nach seiner bestätigten Terminbuchung ein Kundenkonto erstellt:</p><p>' +
          vn + ' ' + nn + '<br>' + email.toLowerCase() + (tel ? '<br>' + tel : '') +
          '</p><p>Die E-Mail-Adresse war durch die Terminbestätigung bereits nachgewiesen, das Konto ist deshalb sofort nutzbar. Vorhandene Termine dieser Adresse wurden dem Konto zugeordnet.</p>'
        ).catch(function (e) { console.error('[Konto-aus-Buchung-Mail]', e.message); });
      }
      return res.json({ message: 'Konto erstellt. Sie können sich sofort anmelden.', sofort_anmelden: true });
    }

    // Prüfe ob Kunde bereits in DB (über normale E-Mail) -> verknüpfen statt duplizieren.
    // NUR wenn dort noch KEIN aktiver Portal-Zugang besteht (sonst wuerde eine erneute Registrierung
    // ein bereits aktives Konto zuruecksetzen -> DoS; portal_password IS NULL ODER noch nicht freigegeben).
    const bestandskunde = await query(
      'SELECT id FROM kunden WHERE LOWER(email)=$1 AND aktiv=true AND (portal_password IS NULL OR portal_freigegeben = false)',
      [email.toLowerCase()]);

    const token = crypto.randomBytes(32).toString('hex');
    const resetToken = crypto.randomBytes(32).toString('hex'); // fuer Bestandskunden: Passwort-Setz-Link statt vorab gesetztem Passwort
    const ablauf = new Date(Date.now() + 24 * 3600000);
    const now = new Date();
    // Nachweis der Einwilligung: IP (via nginx-Header) + Stand der akzeptierten Dokumente
    const einwilligungIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;
    const agbVersion = 'Stand ' + now.toISOString().substring(0, 10);

    let kundeId;
    if (bestandskunde.rows.length) {
      // Bestandskunde-Verknuepfung: KEIN vom Registrierenden gewaehltes Passwort setzen (sonst
      // Konto-Uebernahme: fremder setzt Passwort -> echter Kunde bestaetigt -> Angreifer haette Zugriff).
      // Stattdessen Reset-Token: nur der E-Mail-Eigentuemer setzt via Link sein Passwort (setzt dabei
      // portal_email_bestaetigt=true). portal_password bleibt NULL -> ohne gesetztes Passwort kein Login.
      kundeId = bestandskunde.rows[0].id;
      await query(
        `UPDATE kunden SET portal_email=$1, portal_password=NULL, portal_aktiv=true,
         portal_freigegeben=false, portal_email_bestaetigt=false,
         portal_bestaetigung_token=NULL, portal_token_ablauf=NULL,
         portal_reset_token=$2, portal_reset_ablauf=$3,
         portal_registriert_am=$4, portal_agb_akzeptiert=$5, portal_agb_datum=$4,
         portal_dsgvo_akzeptiert=$5, portal_dsgvo_datum=$4,
         einwilligung_saison_erinnerung=$6, einwilligung_ip=$8, agb_version=$9,
         einwilligung_bewertung=$10, einwilligung_bewertung_am=$11
         WHERE id=$7`,
        [email.toLowerCase(), resetToken, ablauf, now, true, saison ? true : false, kundeId, einwilligungIp, agbVersion, bewertung ? true : false, bewertung ? now : null]
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
         einwilligung_ip, agb_version, einwilligung_bewertung, einwilligung_bewertung_am, aktiv)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,false,false,$8,$9,$10,true,$10,true,$10,$11,$12,$13,$14,$15,true)
         RETURNING id`,
        [nr, vn, nn, email.toLowerCase(), tel,
         email.toLowerCase(), hash, token, ablauf, now, saison ? true : false, einwilligungIp, agbVersion,
         bewertung ? true : false, bewertung ? now : null]
      );
      kundeId = neu.rows[0].id;
    }

    // Mails NICHT awaiten (fire-and-forget mit .catch) -> Antwortzeit haengt nicht am Mailversand (Timing-Enum).
    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    const portalUrl = einst.portal_url || 'http://161.97.187.239/reifenpro/portal/';
    if (bestandskunde.rows.length) {
      // Bestandskunde: Link zum Passwort-Festlegen (bestaetigt zugleich die E-Mail). Kein vorab gesetztes Passwort.
      const setzLink = portalUrl + '?reset=' + resetToken;
      sendMail(
        email,
        'Portal-Zugang einrichten — Schröder & Scholz',
        portalMailHtml(einst, {
          titel: 'Ihren Portal-Zugang einrichten',
          name: vn,
          absaetze: [
            'für Ihre E-Mail-Adresse besteht bei uns bereits ein Kundenkonto. Um den Online-Zugang einzurichten, vergeben Sie bitte über den folgenden Button Ihr Passwort.',
            'Anschließend prüfen wir Ihren Zugang und schalten ihn frei — danach sehen Sie Ihre eingelagerten Räder und können Termine bequem online buchen.'
          ],
          button: { text: 'Passwort festlegen', url: setzLink },
          hinweis: 'Der Link ist 24 Stunden gültig. Falls Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren — ohne Ihr Zutun wird kein Zugang aktiv.'
        })
      ).catch(function (e) { console.error('[Registrierung-Setzlink-Mail]', e.message); });
    } else {
      // Neuer Kunde: klassische E-Mail-Bestaetigung (Passwort wurde gesetzt).
      const link = portalUrl + '?bestaetigen=' + token;
      sendMail(
        email,
        'Bitte bestätigen Sie Ihre E-Mail — Schröder & Scholz',
        portalMailHtml(einst, {
          titel: 'Willkommen im Kundenportal',
          name: vn,
          absaetze: [
            'vielen Dank für Ihre Registrierung im Kundenportal von Schröder &amp; Scholz.',
            'Bitte bestätigen Sie Ihre E-Mail-Adresse mit einem Klick auf den folgenden Button. Anschließend prüfen wir Ihren Zugang und schalten ihn frei — danach können Sie Ihre eingelagerten Räder einsehen und Termine bequem online buchen.'
          ],
          button: { text: 'E-Mail bestätigen', url: link },
          hinweis: 'Der Bestätigungslink ist 24 Stunden gültig. Falls Sie sich nicht registriert haben, können Sie diese E-Mail ignorieren.'
        })
      ).catch(function (e) { console.error('[Registrierung-Mail]', e.message); });
    }

    // Admin informieren (fire-and-forget)
    if (einst.email) {
      sendMail(
        einst.email,
        'Neue Portal-Registrierung: ' + vn + ' ' + nn,
        '<p>Ein neuer Kunde hat sich im Portal registriert:</p>' +
        '<p><strong>' + vn + ' ' + nn + '</strong><br>' +
        'E-Mail: ' + emailSafe + '<br>' +
        (tel ? 'Telefon: ' + tel + '<br>' : '') +
        (bestandskunde.rows.length ? 'Bestandskunde — Portal-Zugang beantragt' : 'Neuer Kunde') + '</p>' +
        '<p>Bitte im Admin-Bereich unter Kunden freigeben.</p>'
      ).catch(() => {});
    }

    // Werbe-/Saison-Einwilligung nur per Double-Opt-in wirksam: Bestaetigungsmail (fire-and-forget)
    if (saison) {
      Promise.resolve()
        .then(function () { return require('../lib/einwilligung').sendeDoi({ id: kundeId, vorname: vn, nachname: nn, anrede: null, email: email }, einst); })
        .catch(function (e) { console.error('[DOI-Mail]', e.message); });
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

// ── POST /api/portal/auth/bestaetigung-erneut ── Bestaetigungsmail erneut senden (Rettung bei verlorener Mail)
router.post('/bestaetigung-erneut', resetLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ message: 'ok' });
    const k = (await query('SELECT * FROM kunden WHERE LOWER(portal_email)=$1 AND portal_aktiv=true AND portal_email_bestaetigt=false', [String(email).toLowerCase()])).rows[0];
    if (k) {
      const token = crypto.randomBytes(32).toString('hex');
      const ablauf = new Date(Date.now() + 24 * 3600000);
      await query('UPDATE kunden SET portal_bestaetigung_token=$1, portal_token_ablauf=$2 WHERE id=$3', [token, ablauf, k.id]);
      const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
      const portalUrl = einst.portal_url || 'http://161.97.187.239/reifenpro/portal/';
      const link = portalUrl + '?bestaetigen=' + token;
      await sendMail(
        k.portal_email,
        'Bitte bestätigen Sie Ihre E-Mail — Schröder & Scholz',
        portalMailHtml(einst, {
          titel: 'E-Mail bestätigen', name: k.vorname,
          absaetze: ['bitte bestätigen Sie Ihre E-Mail-Adresse mit einem Klick auf den folgenden Button, damit wir Ihren Zugang freischalten können.'],
          button: { text: 'E-Mail bestätigen', url: link },
          hinweis: 'Der Bestätigungslink ist 24 Stunden gültig.'
        })
      ).catch(function (e) { console.error('[Resend-Mail]', e.message); });
    }
    // Generische Antwort (keine Auskunft, ob die E-Mail existiert)
    res.json({ message: 'ok' });
  } catch (e) { next(e); }
});

// ── POST /api/portal/auth/login ──
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, passwort } = req.body;
    if (!email || !passwort) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
    const { rows } = await query('SELECT * FROM kunden WHERE portal_email=$1 AND portal_aktiv=true', [email.toLowerCase()]);
    const k = rows[0];
    // Passwort IMMER pruefen (auch bei unbekannter E-Mail ODER noch nicht gesetztem Passwort gegen
    // Dummy-Hash) -> kein Timing-/Status-Leak, kein Crash bei portal_password=NULL (Bestandskunde vor
    // dem Setzen des Passworts). bcrypt.compare(pw, null) wuerde sonst werfen -> 500-Enumeration.
    const ok = await bcrypt.compare(passwort, (k && k.portal_password) ? k.portal_password : DUMMY_HASH);
    if (!k || !k.portal_password || !ok) return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
    // Status-Hinweise erst NACH korrektem Passwort (verraet sonst Existenz des Kontos)
    // code: maschinenlesbar, damit das Portal die Meldung lokalisieren kann (DE/EN); error bleibt als Fallback
    if (!k.portal_email_bestaetigt) return res.status(401).json({ code: 'EMAIL_UNBESTAETIGT', error: 'E-Mail noch nicht bestätigt. Bitte prüfen Sie Ihr Postfach.' });
    if (!k.portal_freigegeben) return res.status(401).json({ code: 'NICHT_FREIGEGEBEN', error: 'Ihr Konto wurde noch nicht freigeschaltet. Wir melden uns in Kürze.' });
    const token = jwt.sign({ id: k.id, typ: 'kunde' }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({
      token,
      kunde: { id: k.id, vorname: k.vorname, nachname: k.nachname, email: k.portal_email, kennzeichen: k.kennzeichen, fahrzeug_marke: k.fahrzeug_marke, fahrzeug_modell: k.fahrzeug_modell, hu_datum: k.hu_datum, ist_gewerbe: k.ist_gewerbe }
    });
  } catch (e) { next(e); }
});

// ── POST /api/portal/auth/passwort-vergessen ──
router.post('/passwort-vergessen', resetLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ message: 'ok' });
    const { rows } = await query('SELECT * FROM kunden WHERE portal_email=$1 AND portal_aktiv=true', [email.toLowerCase()]);
    if (!rows.length) return res.json({ message: 'ok' });
    const k = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const ablauf = new Date(Date.now() + 3600000);
    await query('UPDATE kunden SET portal_reset_token=$1, portal_reset_ablauf=$2 WHERE id=$3', [token, ablauf, k.id]);
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
    const { rows } = await query('SELECT id FROM kunden WHERE portal_reset_token=$1 AND portal_reset_ablauf > NOW()', [token]);
    if (!rows.length) return res.status(400).json({ error: 'Token ungültig oder abgelaufen' });
    const hash = await bcrypt.hash(passwort, 12);
    // Passwort setzen + E-Mail als bestaetigt markieren: der Klick auf den Link beweist die E-Mail-Kontrolle.
    // Fuer normale Resets ist portal_email_bestaetigt bereits true (idempotent); fuer die Bestandskunden-
    // Zugangseinrichtung (P1) ist DAS der Schritt, der die E-Mail bestaetigt.
    await query('UPDATE kunden SET portal_password=$1, portal_reset_token=null, portal_reset_ablauf=null, portal_email_bestaetigt=true, passwort_geaendert_am=NOW() WHERE id=$2', [hash, rows[0].id]);
    res.json({ message: 'Passwort erfolgreich geändert' });
  } catch (e) { next(e); }
});

// ── GET /api/portal/auth/me ──
router.get('/me', authKunde, async (req, res) => {
  const k = req.kunde;
  res.json({ id: k.id, vorname: k.vorname, nachname: k.nachname, email: k.portal_email, telefon: k.telefon, kennzeichen: k.kennzeichen, fahrzeug_marke: k.fahrzeug_marke, fahrzeug_modell: k.fahrzeug_modell, fahrzeug_typ: k.fahrzeug_typ, hu_datum: k.hu_datum, anrede: k.anrede, ist_gewerbe: k.ist_gewerbe, kunden_nr: k.kunden_nr });
});

// ── PUT /api/portal/auth/profil ──
router.put('/profil', authKunde, async (req, res, next) => {
  try {
    const clean = (s) => s == null ? null : String(s).replace(/[<>]/g, '').slice(0, 80);
    const telefon = clean(req.body.telefon), kennzeichen = clean(req.body.kennzeichen),
          fahrzeug_marke = clean(req.body.fahrzeug_marke), fahrzeug_modell = clean(req.body.fahrzeug_modell);
    // COALESCE: nur uebergebene Felder aendern, fehlende NICHT auf NULL setzen (sonst Datenverlust)
    await query(
      `UPDATE kunden SET telefon=COALESCE($1,telefon), kennzeichen=COALESCE($2,kennzeichen),
       fahrzeug_marke=COALESCE($3,fahrzeug_marke), fahrzeug_modell=COALESCE($4,fahrzeug_modell), geaendert_am=NOW() WHERE id=$5`,
      [telefon != null ? telefon : null, kennzeichen != null ? kennzeichen : null,
       fahrzeug_marke != null ? fahrzeug_marke : null, fahrzeug_modell != null ? fahrzeug_modell : null, req.kunde.id]);
    res.json({ message: 'Profil aktualisiert' });
  } catch (e) { next(e); }
});

// ── PUT /api/portal/auth/passwort-aendern ── Passwort im eingeloggten Zustand aendern
router.put('/passwort-aendern', authKunde, async (req, res, next) => {
  try {
    const { passwort } = req.body;
    if (!passwort || passwort.length < 8) return res.status(400).json({ error: 'Passwort muss mind. 8 Zeichen haben.' });
    const hash = await bcrypt.hash(passwort, 12);
    await query('UPDATE kunden SET portal_password=$1, passwort_geaendert_am=NOW(), geaendert_am=NOW() WHERE id=$2', [hash, req.kunde.id]);
    res.json({ message: 'Passwort geändert' });
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

// ── POST /api/portal/auth/einwilligung-widerrufen ── Werbe-/Saison-Einwilligung widerrufen (Art. 7 Abs. 3 DSGVO)
router.post('/einwilligung-widerrufen', authKunde, async (req, res, next) => {
  try {
    await query(
      `UPDATE kunden SET einwilligung_werbung=false, einwilligung_saison_erinnerung=false,
       einwilligung_saison_bestaetigt=false, einwilligung_bewertung=false, einwilligung_bewertung_am=NULL,
       einwilligung_token=NULL, einwilligung_token_ablauf=NULL,
       widerruf_datum=NOW(), geaendert_am=NOW() WHERE id=$1`,
      [req.kunde.id]
    );
    res.json({ message: 'Ihre Einwilligung wurde widerrufen. Sie erhalten keine Werbe-, Saison- oder Bewertungs-E-Mails mehr.' });
  } catch (e) { next(e); }
});

// ── POST /api/portal/auth/personal/bestaetigung-erneut/:kundenId ──
// Personal-Variante von "Bestaetigungsmail erneut senden". Anlass: Klickt der Kunde den Link nie
// (Spam-Ordner, Tippfehler, abgelaufen), kommt der Betrieb aus der Lage sonst nicht heraus — der
// Admin-Knopf "Freischalten" erscheint erst nach bestaetigter E-Mail, und eine erneute Registrierung
// mit derselben Adresse hilft dem Kunden NICHT: die Route oben antwortet dann bewusst generisch
// und OHNE Mail (Anti-Enumeration). Hier ist der Ausweg.
//
// Unterschiede zur kundenseitigen Route: Adressierung ueber die kunden_id (das Personal sieht den
// Datensatz ohnehin), kein resetLimiter (der schuetzt vor Fremdmissbrauch, nicht vor dem Inhaber)
// und eine ECHTE Rueckmeldung statt der generischen — Anti-Enumeration ist gegenueber angemeldetem
// Personal sinnlos, und der Betrieb muss wissen, ob die Mail rausging.
router.post('/personal/bestaetigung-erneut/:kundenId', authenticate, requireStaff, async (req, res, next) => {
  try {
    const k = (await query('SELECT * FROM kunden WHERE id=$1', [req.params.kundenId])).rows[0];
    if (!k) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    if (!k.portal_email) return res.status(400).json({ error: 'Für diesen Kunden ist kein Portal-Zugang angelegt.' });
    // Gleicher Zustandsfilter wie kundenseitig: sonst verschickt der Knopf sinnlose Mails an
    // Kunden, die laengst bestaetigt haben und nur auf die Freischaltung warten.
    if (k.portal_email_bestaetigt) {
      return res.status(409).json({ error: 'Die E-Mail ist bereits bestätigt. Dieser Kunde wartet nur noch auf die Freischaltung.' });
    }
    if (!k.portal_aktiv) return res.status(409).json({ error: 'Der Portal-Zugang dieses Kunden ist deaktiviert.' });

    const token = crypto.randomBytes(32).toString('hex');
    const ablauf = new Date(Date.now() + 24 * 3600000);
    await query('UPDATE kunden SET portal_bestaetigung_token=$1, portal_token_ablauf=$2 WHERE id=$3', [token, ablauf, k.id]);
    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    const portalUrl = einst.portal_url || 'http://161.97.187.239/reifenpro/portal/';
    const link = portalUrl + '?bestaetigen=' + token;
    let versandt = true;
    await sendMail(
      k.portal_email,
      'Bitte bestätigen Sie Ihre E-Mail — Schröder & Scholz',
      portalMailHtml(einst, {
        titel: 'E-Mail bestätigen', name: k.vorname,
        absaetze: ['bitte bestätigen Sie Ihre E-Mail-Adresse mit einem Klick auf den folgenden Button, damit wir Ihren Zugang freischalten können.'],
        button: { text: 'E-Mail bestätigen', url: link },
        hinweis: 'Der Bestätigungslink ist 24 Stunden gültig.'
      })
    ).catch(function (e) { versandt = false; console.error('[Resend-Personal-Mail]', e.message); });
    // Ehrliche Rueckmeldung: der Betrieb soll nicht glauben, die Mail sei raus, wenn der Versand scheiterte.
    if (!versandt) return res.status(502).json({ error: 'Der neue Link wurde gesetzt, aber die E-Mail konnte nicht versendet werden. Bitte E-Mail-Einstellungen prüfen.' });
    res.json({ message: 'Bestätigungsmail wurde erneut an ' + k.portal_email + ' gesendet.', gueltig_bis: ablauf });
  } catch (e) {
    // Der Unique-Index auf LOWER(portal_email) kann hier nicht greifen (wir aendern die Adresse nicht),
    // aber eine verstaendliche Meldung statt eines rohen 500 kostet nichts.
    if (e && e.code === '23505') return res.status(409).json({ error: 'Diese Portal-Adresse ist bereits einem anderen Kunden zugeordnet.' });
    next(e);
  }
});

module.exports = router;
module.exports.authKunde = authKunde;
