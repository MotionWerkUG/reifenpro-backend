'use strict';
// ════════════════════════════════════════════════════════════════
// ReifenPro — Automatische E-Mail-Erinnerungen
// Ausführung per Cron, z.B. täglich 08:00 Uhr:
//   0 8 * * *  cd /var/www/reifenpro-backend && node cron-erinnerungen.js >> /var/log/reifenpro-cron.log 2>&1
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const { query } = require('./src/db/index');
const nodemailer = require('nodemailer');

async function sendMail(to, subject, html) {
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: '"' + (einst.firmenname || 'Schröder & Scholz') + '" <' + process.env.SMTP_USER + '>',
    to, subject, html
  });
}

function fmtDatum(d) {
  return new Date(d).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── 1. TERMIN-ERINNERUNG 48 STUNDEN VORHER ──
async function terminErinnerungen() {
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
  // Termine die in 2 Tagen stattfinden, bestätigt, noch keine Erinnerung gesendet
  const inZweiTagen = new Date();
  inZweiTagen.setDate(inZweiTagen.getDate() + 2);
  const datumStr = inZweiTagen.toISOString().substring(0, 10);

  const { rows } = await query(
    `SELECT t.*, k.vorname, k.nachname, k.portal_email, k.email, a.name AS artikel_name
     FROM termine t
     LEFT JOIN kunden k ON k.id = t.kunden_id
     LEFT JOIN artikel a ON a.id = t.artikel_id
     WHERE t.datum = $1
       AND t.status NOT IN ('storniert', 'abgesagt')
       AND (t.erinnerung_gesendet IS NULL OR t.erinnerung_gesendet = false)
       AND (k.portal_email IS NOT NULL OR k.email IS NOT NULL OR t.kontakt_email IS NOT NULL)`,
    [datumStr]
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
        '<p>Mit freundlichen Grüßen,<br>' + (einst.firmenname || 'Schröder & Scholz') + '</p>'
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

  const gegenSaison = saison === 'Winter' ? 'Sommerreifen' : 'Winterreifen';
  let gesendet = 0;
  for (const k of rows) {
    const mail = k.portal_email || k.email;
    if (!mail) continue;
    try {
      await sendMail(
        mail,
        'Zeit für den Reifenwechsel — ' + (einst.firmenname || 'Schröder & Scholz'),
        '<p>Hallo ' + k.vorname + ',</p>' +
        '<p>die ' + saison + 'saison steht vor der Tür. Es ist Zeit, von ' + gegenSaison + ' auf ' + saison + 'reifen zu wechseln.</p>' +
        '<p>Buchen Sie jetzt bequem online Ihren Wunschtermin in unserem Kundenportal:</p>' +
        '<p><a href="' + (einst.portal_url || 'http://161.97.187.239/reifenpro/portal/') + '" style="background:#eab308;color:#171717;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:bold">Termin buchen</a></p>' +
        '<p>Mit freundlichen Grüßen,<br>' + (einst.firmenname || 'Schröder & Scholz') + '</p>' +
        '<p style="font-size:11px;color:#888">Sie erhalten diese E-Mail, weil Sie Saison-Erinnerungen abonniert haben. Sie können dem jederzeit widersprechen.</p>'
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

  const inVierWochen = new Date();
  inVierWochen.setDate(inVierWochen.getDate() + 28);
  const datumStr = inVierWochen.toISOString().substring(0, 10);

  const { rows } = await query(
    `SELECT f.id AS fahrzeug_id, f.kennzeichen, f.hu_datum,
            k.vorname, k.nachname, k.portal_email, k.email
     FROM fahrzeuge f
     JOIN kunden k ON k.id = f.kunden_id
     WHERE f.hu_datum = $1
       AND (k.portal_email IS NOT NULL OR k.email IS NOT NULL)
       AND k.aktiv = true
       AND (f.hu_erinnerung_gesendet IS NULL OR f.hu_erinnerung_gesendet = false)`,
    [datumStr]
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
        '<p>die Hauptuntersuchung (HU/TÜV) für Ihr Fahrzeug ' + (k.kennzeichen || '') + ' ist in etwa vier Wochen fällig (' + fmtDatum(k.hu_datum) + ').</p>' +
        '<p>Vereinbaren Sie rechtzeitig einen Termin.</p>' +
        '<p>Mit freundlichen Grüßen,<br>' + (einst.firmenname || 'Schröder & Scholz') + '</p>'
      );
      await query('UPDATE fahrzeuge SET hu_erinnerung_gesendet = true WHERE id = $1', [k.fahrzeug_id]);
      gesendet++;
    } catch (e) {
      console.error('Fehler HU-Warnung ' + k.fahrzeug_id + ':', e.message);
    }
  }
  console.log('[' + new Date().toISOString() + '] HU-Warnungen gesendet:', gesendet);
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
    await loeschkonzept();
  } catch (e) {
    console.error('Cron-Fehler:', e.message);
  } finally {
    process.exit(0);
  }
})();
