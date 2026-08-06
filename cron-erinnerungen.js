'use strict';
// ════════════════════════════════════════════════════════════════
// ReifenPro — Automatische E-Mail-Erinnerungen
// Ausführung per Cron, z.B. täglich 08:00 Uhr:
//   0 8 * * *  cd /var/www/reifenpro-backend && node cron-erinnerungen.js >> /var/log/reifenpro-cron.log 2>&1
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const { query } = require('./src/db/index');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

// Oeffentlicher 1-Klick-Abmeldelink fuer Werbe-Mails (Pflicht nach § 7 UWG). Token 1 Jahr gueltig.
function abmeldeLink(kundeId) {
  try {
    const token = jwt.sign({ id: kundeId, typ: 'unsub' }, process.env.JWT_SECRET, { expiresIn: '365d' });
    return 'https://www.schroeder-scholz.de/api/gast/einwilligung/abmelden?token=' + token;
  } catch (e) { return null; }
}

// Jede versendete Mail wird protokolliert (Audit-Trail, GoBD/DSGVO-Nachweis).
async function logMail(empf, betreff, typ, status, fehler, bezugId) {
  try {
    await query('INSERT INTO email_log (empfaenger, betreff, typ, status, fehler_msg, bezug_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [empf || null, betreff || null, typ || 'system', status, fehler || null, bezugId || null]);
  } catch (e) { console.error('[email_log]', e.message); }
}

async function sendMail(to, subject, html, typ, bezugId) {
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  try {
    await transporter.sendMail({
      from: '"' + (einst.firmenname || 'Schröder & Scholz') + '" <' + process.env.SMTP_USER + '>',
      to, subject, html
    });
    await logMail(to, subject, typ, 'ok', null, bezugId);
  } catch (e) {
    await logMail(to, subject, typ, 'fehler', e.message, bezugId);
    throw e;
  }
}

function fmtDatum(d) {
  return new Date(d).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── 1. TERMIN-ERINNERUNG 48 STUNDEN VORHER ──
async function terminErinnerungen() {
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
  // Fenster morgen..uebermorgen (statt exakt +2 Tage) -> ein verpasster Lauf holt die Erinnerung nach.
  // Datum in SQL gerechnet (CURRENT_DATE) statt UTC-JS -> kein Zeitzonen-Off-by-one.
  const { rows } = await query(
    `SELECT t.*, k.vorname, k.nachname, k.portal_email, k.email, a.name AS artikel_name
     FROM termine t
     LEFT JOIN kunden k ON k.id = t.kunden_id
     LEFT JOIN artikel a ON a.id = t.artikel_id
     WHERE t.datum BETWEEN CURRENT_DATE + 1 AND CURRENT_DATE + 2
       AND t.status NOT IN ('storniert', 'abgesagt')
       AND (t.erinnerung_gesendet IS NULL OR t.erinnerung_gesendet = false)
       AND (k.portal_email IS NOT NULL OR k.email IS NOT NULL OR t.kontakt_email IS NOT NULL)`
  );

  let gesendet = 0;
  for (const t of rows) {
    const mail = t.portal_email || t.email || t.kontakt_email;
    if (!mail) continue;
    const name = t.vorname || t.kontakt_name || 'Kunde';
    const leistung = t.artikel_name || t.termin_typ || 'Termin';
    try {
      await sendMail(
        mail,
        'Terminerinnerung — ' + (einst.firmenname || 'Schröder & Scholz'),
        '<p>Hallo ' + name + ',</p>' +
        '<p>wir möchten Sie an Ihren Termin erinnern:</p>' +
        '<p style="font-size:16px"><strong>' + fmtDatum(t.datum) + '</strong><br>' +
        'Uhrzeit: ' + (t.uhrzeit_von || '').substring(0,5) + ' Uhr<br>' +
        'Leistung: ' + leistung + '</p>' +
        '<p>Wir freuen uns auf Ihren Besuch.</p>' +
        '<p>Mit freundlichen Grüßen,<br>' + (einst.firmenname || 'Schröder & Scholz') + '</p>',
        'terminerinnerung', t.id
      );
      await query('UPDATE termine SET erinnerung_gesendet = true WHERE id = $1', [t.id]);
      gesendet++;
    } catch (e) {
      console.error('Fehler Terminerinnerung ' + t.id + ':', e.message);
    }
  }
  console.log('[' + new Date().toISOString() + '] Terminerinnerungen gesendet:', gesendet);
}

// ── 2. SAISON-ERINNERUNG (1. Oktober Winter / 1. April Sommer) ──
async function saisonErinnerung() {
  const heute = new Date();
  const monat = heute.getMonth() + 1;
  const tag = heute.getDate();

  // Nur am 1. Oktober oder 1. April
  let saison = null;
  if (monat === 10 && tag === 1) saison = 'Winter';
  else if (monat === 4 && tag === 1) saison = 'Sommer';
  if (!saison) { console.log('[' + new Date().toISOString() + '] Keine Saison-Erinnerung heute.'); return; }

  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
  // Nur Kunden mit per Double-Opt-in BESTAETIGTER Einwilligung
  const { rows } = await query(
    `SELECT DISTINCT k.id, k.vorname, k.nachname, k.portal_email, k.email
     FROM kunden k
     WHERE k.einwilligung_saison_erinnerung = true
       AND k.einwilligung_saison_bestaetigt = true
       AND (k.portal_email IS NOT NULL OR k.email IS NOT NULL)
       AND k.aktiv = true`
  );

  const gegenSaison = saison === 'Winter' ? 'Sommerrädern' : 'Winterrädern';
  let gesendet = 0;
  for (const k of rows) {
    const mail = k.portal_email || k.email;
    if (!mail) continue;
    const link = abmeldeLink(k.id);
    const abmeldung = link
      ? 'Sie erhalten diese E-Mail, weil Sie Saison-Erinnerungen abonniert haben. <a href="' + link + '">Hier mit einem Klick abmelden</a>.'
      : 'Sie erhalten diese E-Mail, weil Sie Saison-Erinnerungen abonniert haben. Sie können dem jederzeit widersprechen.';
    try {
      await sendMail(
        mail,
        'Zeit für den Räderwechsel — ' + (einst.firmenname || 'Schröder & Scholz'),
        '<p>Hallo ' + k.vorname + ',</p>' +
        '<p>die ' + saison + 'saison steht vor der Tür. Es ist Zeit für den Räderwechsel von ' + gegenSaison + ' auf ' + saison + 'räder.</p>' +
        '<p>Buchen Sie jetzt bequem online Ihren Wunschtermin in unserem Kundenportal:</p>' +
        '<p><a href="' + (einst.portal_url || 'http://161.97.187.239/reifenpro/portal/') + '" style="background:#eab308;color:#171717;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:bold">Termin buchen</a></p>' +
        '<p>Mit freundlichen Grüßen,<br>' + (einst.firmenname || 'Schröder & Scholz') + '</p>' +
        '<p style="font-size:11px;color:#888">' + abmeldung + '</p>',
        'saison', k.id
      );
      gesendet++;
    } catch (e) {
      console.error('Fehler Saison-Erinnerung ' + k.id + ':', e.message);
    }
  }
  console.log('[' + new Date().toISOString() + '] Saison-Erinnerungen (' + saison + ') gesendet:', gesendet);
}

// ── 3. HU-FRISTWARNUNG (Hauptuntersuchung, 4 Wochen vorher) ──
async function huWarnung() {
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};

  // Fenster: HU faellig innerhalb der naechsten 4 Wochen, einmalig (Flag) -> verpasster Lauf holt nach.
  const { rows } = await query(
    `SELECT f.id AS fahrzeug_id, f.kennzeichen, f.hu_datum,
            k.vorname, k.nachname, k.portal_email, k.email
     FROM fahrzeuge f
     JOIN kunden k ON k.id = f.kunden_id
     WHERE f.hu_datum BETWEEN CURRENT_DATE AND CURRENT_DATE + 28
       AND (k.portal_email IS NOT NULL OR k.email IS NOT NULL)
       AND k.aktiv = true
       AND (f.hu_erinnerung_gesendet IS NULL OR f.hu_erinnerung_gesendet = false)`
  );

  let gesendet = 0;
  for (const k of rows) {
    const mail = k.portal_email || k.email;
    if (!mail) continue;
    try {
      await sendMail(
        mail,
        'HU-Fälligkeit — ' + (einst.firmenname || 'Schröder & Scholz'),
        '<p>Hallo ' + k.vorname + ',</p>' +
        '<p>die Hauptuntersuchung (HU/TÜV) für Ihr Fahrzeug ' + (k.kennzeichen || '') + ' ist demnächst fällig (' + fmtDatum(k.hu_datum) + ').</p>' +
        '<p>Vereinbaren Sie rechtzeitig einen Termin.</p>' +
        '<p>Mit freundlichen Grüßen,<br>' + (einst.firmenname || 'Schröder & Scholz') + '</p>' +
        '<p style="font-size:11px;color:#888">Dieser Hinweis ergeht als Service zu Ihrem bei uns hinterlegten Fahrzeug. Möchten Sie keine HU-Erinnerungen erhalten, antworten Sie kurz auf diese E-Mail.</p>',
        'hu', k.fahrzeug_id
      );
      await query('UPDATE fahrzeuge SET hu_erinnerung_gesendet = true WHERE id = $1', [k.fahrzeug_id]);
      gesendet++;
    } catch (e) {
      console.error('Fehler HU-Warnung ' + k.fahrzeug_id + ':', e.message);
    }
  }
  console.log('[' + new Date().toISOString() + '] HU-Warnungen gesendet:', gesendet);
}

// ── BEWERTUNGSANFRAGE NACH ABGESCHLOSSENEM TERMIN ──
// Bittet zufriedene Kunden 1-14 Tage nach dem erledigten Termin um eine Google-Bewertung.
// Nur aktiv, wenn in den Einstellungen eine google_bewertung_url hinterlegt ist. Einmalig je Termin.
async function bewertungsAnfrage() {
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
  const url = einst.google_bewertung_url;
  if (!url) { console.log('[' + new Date().toISOString() + '] Bewertungsanfrage: keine google_bewertung_url hinterlegt.'); return; }
  const { rows } = await query(
    `SELECT t.id, t.kontakt_name, t.kontakt_email, k.vorname, k.portal_email, k.email
     FROM termine t LEFT JOIN kunden k ON k.id = t.kunden_id
     WHERE t.status = 'abgeschlossen'
       AND t.datum BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 1
       AND (t.bewertung_gesendet IS NULL OR t.bewertung_gesendet = false)
       AND (k.portal_email IS NOT NULL OR k.email IS NOT NULL OR t.kontakt_email IS NOT NULL)`
  );
  const firma = einst.firmenname || 'Schröder & Scholz';
  let gesendet = 0;
  for (const t of rows) {
    const mail = t.portal_email || t.email || t.kontakt_email;
    if (!mail) continue;
    const name = t.vorname || t.kontakt_name || 'Kunde';
    try {
      await sendMail(
        mail,
        'Wie war Ihr Besuch bei ' + firma + '?',
        '<p>Hallo ' + name + ',</p>' +
        '<p>vielen Dank für Ihren Besuch. Wenn Sie zufrieden waren, freuen wir uns sehr über eine kurze Bewertung – das dauert nur eine Minute und hilft uns sehr:</p>' +
        '<p><a href="' + url + '" style="background:#eab308;color:#171717;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:bold">Jetzt bei Google bewerten</a></p>' +
        '<p>Vielen Dank und bis zum nächsten Mal!<br>' + firma + '</p>',
        'bewertung', t.id
      );
      await query('UPDATE termine SET bewertung_gesendet = true WHERE id = $1', [t.id]);
      gesendet++;
    } catch (e) {
      console.error('Fehler Bewertungsanfrage ' + t.id + ':', e.message);
    }
  }
  console.log('[' + new Date().toISOString() + '] Bewertungsanfragen gesendet:', gesendet);
}

// ── LOESCHKONZEPT / DATENSPARSAMKEIT ──
// (1) Personenbezug alter GAST-Termine (ohne Kundenkonto) nach 24 Monaten entfernen (Statistik-Zeile bleibt).
// (2) Werbung stoppen, wo die Einwilligung trotz Aufforderung nicht per Double-Opt-in bestaetigt wurde
//     (Token abgelaufen). Es werden KEINE Kundendaten geloescht (Aufbewahrungspflicht bleibt gewahrt).
async function loeschkonzept() {
  const anon = await query(
    `UPDATE termine SET kontakt_name=NULL, kontakt_anrede=NULL, kontakt_vorname=NULL, kontakt_nachname=NULL,
       kontakt_telefon=NULL, kontakt_email=NULL, kontakt_strasse=NULL, kontakt_plz=NULL, kontakt_ort=NULL,
       kennzeichen=NULL, beschreibung='(anonymisiert nach Aufbewahrungsfrist)'
     WHERE kunden_id IS NULL AND datum < (CURRENT_DATE - INTERVAL '24 months')
       AND (kontakt_name IS NOT NULL OR kontakt_email IS NOT NULL OR kennzeichen IS NOT NULL)`
  );
  const stop = await query(
    `UPDATE kunden SET einwilligung_saison_erinnerung=false, einwilligung_token=NULL, einwilligung_token_ablauf=NULL
     WHERE einwilligung_saison_erinnerung=true AND einwilligung_saison_bestaetigt IS NOT TRUE
       AND einwilligung_token_ablauf IS NOT NULL AND einwilligung_token_ablauf < NOW()`
  );
  console.log('[' + new Date().toISOString() + '] Loeschkonzept: ' + (anon.rowCount || 0) + ' Gast-Termine anonymisiert, ' + (stop.rowCount || 0) + ' unbestaetigte Werbe-Einwilligungen gestoppt.');
}

// ── HAUPTLAUF ──
(async () => {
  try {
    await terminErinnerungen();
    await saisonErinnerung();
    await huWarnung();
    await bewertungsAnfrage();
    await loeschkonzept();
  } catch (e) {
    console.error('Cron-Fehler:', e.message);
  } finally {
    process.exit(0);
  }
})();
