'use strict';
// Elektronische Widerrufsfunktion nach § 356a BGB — in Kraft seit dem 19.06.2026.
//
// WAS DAS GESETZ VERLANGT (und warum es hier so gebaut ist):
// Wer Verbrauchern ueber eine Online-Oberflaeche Fernabsatzvertraege ermoeglicht — und die
// Terminbuchung auf der Website ist genau das —, muss eine Widerrufsfunktion bereitstellen:
//   1. Eine Schaltflaeche "Vertrag widerrufen", staendig verfuegbar und leicht zugaenglich.
//      NICHT hinter einer Anmeldung: Buchen kann man bei uns auch als Gast.
//   2. Dahinter eine Bestaetigungsseite mit GENAU DREI Angaben — Name, Angaben zur
//      Identifizierung des Vertrags, elektronisches Kommunikationsmittel fuer die Bestaetigung.
//      Mehr abzufragen ist rechtlich riskant, weniger genuegt nicht.
//   3. Eine zweite Schaltflaeche "Widerruf bestaetigen".
//   4. Eine unverzuegliche Eingangsbestaetigung auf einem DAUERHAFTEN DATENTRAEGER mit dem
//      Inhalt der Erklaerung sowie Datum und Uhrzeit des Eingangs. Eine Webseite reicht dafuer
//      nicht — eine E-Mail schon.
//
// Fehlt die Funktion, verlaengert sich die Widerrufsfrist von 14 Tagen auf zwoelf Monate und
// 14 Tage. Ausnahmen fuer kleine Betriebe gibt es nicht.
//
// WICHTIG: Der Widerruf ist mit dem EINGANG wirksam, nicht mit unserer Bearbeitung. Darum wird
// zuerst gespeichert und erst danach gemailt; scheitert eine Mail, ist der Widerruf trotzdem da.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { query } = require('../db/index');
const { portalMailHtml, esc } = require('../lib/mail-template');
const { sendMail } = require('../lib/mailer');
const { authenticate, requireStaff } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');

// Die Funktion muss oeffentlich erreichbar sein. Ein Begrenzer haelt Bots und Schleifen heraus,
// ohne einen echten Verbraucher auszusperren: Wer widerruft, tut das einmal.
const limiter = rateLimit({
  windowMs: 900000, max: 10,
  message: { error: 'Zu viele Versuche. Bitte versuchen Sie es in einer Viertelstunde erneut oder schreiben Sie uns eine E-Mail.' }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ohneTags = (s) => String(s == null ? '' : s).replace(/[<>]/g, '').trim();

function zeitpunktLang(d) {
  const t = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return p(t.getDate()) + '.' + p(t.getMonth() + 1) + '.' + t.getFullYear() +
    ' um ' + p(t.getHours()) + ':' + p(t.getMinutes()) + ' Uhr';
}

// ── Verbraucher: Widerruf erklaeren (oeffentlich) ────────────────────────────────────────────
router.post('/', limiter, async (req, res, next) => {
  try {
    const { name, vertrag, email, website } = req.body || {};
    if (website) return res.json({ message: 'ok' });   // Honeypot

    const nm = ohneTags(name).slice(0, 200);
    const vt = ohneTags(vertrag).slice(0, 1000);
    const em = String(email == null ? '' : email).trim().slice(0, 200);
    if (!nm) return res.status(400).json({ error: 'Bitte geben Sie Ihren Namen an.' });
    if (!vt) return res.status(400).json({ error: 'Bitte geben Sie an, welchen Vertrag Sie widerrufen möchten — zum Beispiel Datum und Uhrzeit Ihres Termins.' });
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: 'Bitte geben Sie eine gültige E-Mail-Adresse an. An diese senden wir Ihnen die Eingangsbestätigung.' });

    // req.ip, NICHT der X-Forwarded-For-Kopf selbst: Dessen linke Seite gibt der Aufrufer vor.
    // server.js setzt 'trust proxy' auf 1, Express nimmt dann den von nginx angehaengten Wert.
    const ip = (req.ip || '').toString() || null;

    // Zuordnung versuchen, aber NIE erzwingen: Der Widerruf ist auch dann wirksam, wenn wir den
    // Termin nicht auf Anhieb finden. Gefunden wird ueber die angegebene E-Mail-Adresse.
    const zuord = (await query(
      `SELECT t.id AS termin_id, t.kunden_id
         FROM termine t LEFT JOIN kunden k ON k.id = t.kunden_id
        WHERE lower(COALESCE(NULLIF(k.portal_email,''), NULLIF(k.email,''), t.kontakt_email)) = lower($1)
          AND t.status NOT IN ('storniert','abgesagt')
        ORDER BY t.erstellt_am DESC LIMIT 1`, [em])).rows[0] || {};

    const w = (await query(
      `INSERT INTO widerrufe (name, vertrag_angabe, kontakt_email, termin_id, kunden_id, ip)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, eingegangen_am`,
      [nm, vt, em, zuord.termin_id || null, zuord.kunden_id || null, ip])).rows[0];

    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    const eingang = zeitpunktLang(w.eingegangen_am);

    // 1) Eingangsbestaetigung an den Verbraucher — das ist der dauerhafte Datentraeger.
    //    Sie MUSS den Inhalt der Erklaerung sowie Datum und Uhrzeit des Eingangs tragen.
    let bestaetigt = false;
    try {
      await sendMail({
        to: em,
        subject: 'Eingangsbestätigung: Ihr Widerruf vom ' + eingang.split(' um ')[0],
        html: portalMailHtml(einst, {
          titel: 'Wir haben Ihren Widerruf erhalten',
          absaetze: [
            'hiermit bestätigen wir Ihnen den Eingang Ihrer Widerrufserklärung.',
            '<strong>Eingegangen am:</strong> ' + esc(eingang),
            '<strong>Ihr Name:</strong> ' + esc(nm),
            '<strong>Ihre Angaben zum Vertrag:</strong><br>' + esc(vt).replace(/\n/g, '<br>'),
            '<strong>Ihre E-Mail-Adresse:</strong> ' + esc(em),
            'Ihr Widerruf ist mit diesem Eingang wirksam. Wir melden uns bei Ihnen, sobald wir ihn bearbeitet haben. Bereits geleistete Zahlungen erstatten wir Ihnen unverzüglich, spätestens innerhalb von vierzehn Tagen, über dasselbe Zahlungsmittel.',
            'Haben Sie einen Termin bei uns, müssen Sie nichts weiter tun — wir sagen ihn für Sie ab.'
          ],
          hinweis: 'Diese Bestätigung ist Ihr Nachweis. Bitte bewahren Sie sie auf. Wenn etwas nicht stimmt, antworten Sie einfach auf diese E-Mail.'
        })
      });
      await query('UPDATE widerrufe SET bestaetigung_gesendet_am=NOW() WHERE id=$1', [w.id]);
      bestaetigt = true;
    } catch (mailErr) {
      // Der Widerruf bleibt gespeichert. Der Betrieb erfaehrt unten, dass die Bestaetigung
      // fehlt, und muss sie von Hand nachholen -- die Pflicht bleibt bestehen.
      console.error('[Widerruf-Eingangsbestaetigung]', mailErr.message);
    }

    // 2) Benachrichtigung an den Betrieb.
    try {
      await sendMail({
        to: einst.email || process.env.SMTP_USER,
        subject: 'WIDERRUF eingegangen — ' + nm,
        html: portalMailHtml(einst, {
          titel: 'Ein Kunde hat seinen Vertrag widerrufen',
          absaetze: [
            '<strong>Eingegangen am:</strong> ' + esc(eingang),
            '<strong>Name:</strong> ' + esc(nm),
            '<strong>E-Mail:</strong> ' + esc(em),
            '<strong>Angaben zum Vertrag:</strong><br>' + esc(vt).replace(/\n/g, '<br>'),
            zuord.termin_id ? 'Ein passender Termin wurde automatisch zugeordnet.' : '<strong>Kein Termin automatisch zuordenbar</strong> — bitte im Kalender nachsehen.',
            bestaetigt ? 'Die gesetzliche Eingangsbestätigung wurde an den Kunden gesendet.'
                       : '<strong>ACHTUNG: Die Eingangsbestätigung an den Kunden konnte NICHT gesendet werden.</strong> Sie muss unverzüglich von Hand nachgeholt werden — sie ist gesetzlich vorgeschrieben.'
          ],
          hinweis: 'Zu finden im Adminbereich unter Datenschutz und Recht. Der Widerruf ist mit dem Eingang wirksam, unabhängig von der Bearbeitung.'
        })
      });
    } catch (mailErr) { console.error('[Widerruf-Benachrichtigung]', mailErr.message); }

    res.json({ message: 'ok', eingegangen_am: w.eingegangen_am, bestaetigung_gesendet: bestaetigt });
  } catch (e) { next(e); }
});

// ── Betrieb: eingegangene Widerrufe ansehen und abhaken ──────────────────────────────────────
router.get('/', authenticate, requireStaff, async (req, res, next) => {
  try {
    // Mit den drei Angaben, die entscheiden, was zu tun ist -- damit der Betrieb den Fall am
    // Widerruf ablesen kann, statt ihn aus drei Bildschirmen zusammenzusuchen:
    //   1. Wurde schon gearbeitet? (Terminstatus)
    //   2. Lag die Zustimmung zur vorzeitigen Ausfuehrung vor? Dann ist das Widerrufsrecht mit
    //      der vollstaendigen Leistung erloschen (§ 356 Abs. 5 Nr. 2 BGB) und der Widerruf geht ins Leere.
    //   3. Gibt es schon eine Rechnung? Nur dann kommt ueberhaupt ein Storno in Frage.
    const { rows } = await query(
      `SELECT w.*, t.datum AS termin_datum, t.uhrzeit_von AS termin_zeit, t.status AS termin_status,
              t.vorzeitige_leistung, t.vereinbart_ueber, t.kontakt_kundentyp,
              k.kunden_nr, k.kundentyp,
              r.rechnungsnr, r.status AS rechnung_status, r.zahlungsstatus
         FROM widerrufe w
         LEFT JOIN termine t ON t.id = w.termin_id
         LEFT JOIN kunden k ON k.id = w.kunden_id
         LEFT JOIN rechnungen r ON r.id = t.rechnung_id
        ORDER BY w.eingegangen_am DESC LIMIT 300`);
    res.json(rows);
  } catch (e) { next(e); }
});

router.put('/:id', authenticate, requireStaff, async (req, res, next) => {
  try {
    const { status, notiz } = req.body || {};
    if (status && !['offen', 'bearbeitet', 'abgelehnt'].includes(status)) {
      return res.status(400).json({ error: 'Unbekannter Status.' });
    }
    const { rows } = await query(
      `UPDATE widerrufe
          SET status = COALESCE($1, status),
              notiz = COALESCE($2, notiz),
              bearbeitet_am = NOW(),
              bearbeitet_von = $3
        WHERE id = $4 RETURNING id`,
      [status || null, notiz === undefined ? null : ohneTags(notiz).slice(0, 2000), req.user.id, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    await auditLog({ userId: req.user.id, aktion: 'widerruf.bearbeitet', tabelle: 'widerrufe', datensatzId: req.params.id });
    res.json({ message: 'Gespeichert.' });
  } catch (e) { next(e); }
});

module.exports = router;
