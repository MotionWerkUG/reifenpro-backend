// Zustimmung zum vorzeitigen Leistungsbeginn bei telefonisch vereinbarten Terminen.
//
// DER FALL: Ein Kunde ruft an, der Betrieb legt den Termin an. Der Vertrag ist damit am Telefon
// zustande gekommen, ohne dass sich beide gesehen haben — ein Fernabsatzvertrag nach § 312c BGB.
// Entscheidend ist der Moment des Vertragsschlusses, nicht wo spaeter gearbeitet wird. Der Kunde
// hat also dieselben 14 Tage Widerrufsrecht wie bei einer Buchung ueber die Website.
//
// Fast jeder Termin liegt innerhalb dieser 14 Tage. Es wird also gearbeitet, bevor die Frist
// abgelaufen ist. Ohne die ausdrueckliche Zustimmung des Kunden UND seine Bestaetigung, dass er
// den Rechtsverlust kennt (§ 356 Abs. 5 Nr. 2 BGB), koennte er nach getaner Arbeit widerrufen und
// muesste nichts zahlen — § 357a Abs. 2 BGB verlangt fuer den Wertersatz genau dieses Verlangen.
//
// Wer am Tresen bucht, ist NICHT betroffen: Da gab es persoenlichen Kontakt, also keinen
// Fernabsatz.
const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { query } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const { sendMail } = require('../lib/mailer');
const { kundenMailHtml } = require('../lib/mail-template');
const belehrung = require('../lib/widerrufsbelehrung');
const widerruf = require('../lib/widerruf');

const GUELTIG_TAGE = 14;   // solange bleibt der Bestaetigungslink nutzbar

// Der Link steht in einer Mail und wird ueber das offene Netz aufgerufen. Er traegt zwar 256 Bit
// Zufall und ist damit nicht zu raten, aber ein Begrenzer haelt Durchprobieren aus den Protokollen
// heraus und schuetzt vor versehentlichen Schleifen.
const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

function ipVon(req) {
  // req.ip, NICHT der Kopf selbst. server.js setzt 'trust proxy' auf 1 -- Express nimmt dann
  // genau das rechte (von nginx angehaengte) Element aus X-Forwarded-For. Der Kopf selbst traegt
  // links das, was der Client BEHAUPTET; portal-4e hat das heute in ihrem Bereich gefunden
  // (kunden.einwilligung_ip liess sich frei vorgeben) und korrigiert. Dieselbe Falle waere hier
  // fast erneut hineingeraten, weil ich sie zuerst genauso geschrieben hatte.
  return (req.ip || '').toString() || null;
}

function datumLang(d) {
  const t = new Date(String(d).slice(0, 10) + 'T12:00:00');
  const TAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return TAG[t.getDay()] + ', ' + t.getDate() + '. ' + MON[t.getMonth()] + ' ' + t.getFullYear();
}
function hm(z) { return String(z || '').slice(0, 5); }

async function firmendaten() {
  return (await query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
}
function basisUrl(e) {
  return (e.portal_url && e.portal_url.replace(/\/portal\/?$/, '')) || 'https://www.schroeder-scholz.de';
}

// Eine schlichte, in sich stehende Seite — sie wird aus einer Mail heraus aufgerufen, oft auf dem
// Telefon, und darf von nichts abhaengen, was der Kunde nicht schon geladen hat.
function seite(titel, text, ton) {
  const farbe = ton === 'fehler' ? '#c8402a' : '#eab308';
  return '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + titel + ' — Schröder &amp; Scholz</title>' +
    '<style>body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f5f7;' +
    'color:#1a1a1a;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:22px}' +
    '.box{background:#fff;border-radius:16px;padding:34px 30px;max-width:520px;text-align:center;' +
    'box-shadow:0 14px 34px rgba(0,0,0,.1);border-top:4px solid ' + farbe + '}' +
    'h1{font-size:21px;margin:0 0 12px}p{color:#555;font-size:15px;line-height:1.6;margin:0 0 12px}' +
    'a{color:#87680c}</style></head><body><div class="box"><h1>' + titel + '</h1>' + text +
    '<p style="margin-top:20px"><a href="https://www.schroeder-scholz.de/">Zur Startseite</a></p>' +
    '</div></body></html>';
}

// ── Betrieb: Bestaetigung per E-Mail anfordern ──────────────────────────────────────────────
router.post('/anfordern/:terminId', authenticate, requireStaff, async (req, res, next) => {
  try {
    const t = (await query(
      `SELECT termine.id, termine.datum, termine.uhrzeit_von, termine.uhrzeit_bis, termine.termin_typ,
              termine.kennzeichen, termine.leistungen,
              -- Als Kalendertag in Berliner Zeit, nicht als Zeitstempel: Der Treiber lieferte
              -- sonst ein Date-Objekt, aus dem die Fristrechnung "Mon Aug 10" las.
              to_char(termine.erstellt_am AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS vertrag_tag,
              termine.vereinbart_ueber,
              COALESCE(k.vorname, kontakt_vorname) AS vorname,
              COALESCE(k.nachname, kontakt_nachname) AS nachname,
              COALESCE(k.anrede, kontakt_anrede) AS anrede,
              COALESCE(NULLIF(k.portal_email,''), NULLIF(k.email,''), kontakt_email) AS email,
              termine.vorzeitige_leistung
         FROM termine LEFT JOIN kunden k ON k.id = termine.kunden_id
        WHERE termine.id = $1`, [req.params.terminId])).rows[0];
    if (!t) return res.status(404).json({ error: 'Termin nicht gefunden.' });
    if (!t.email) return res.status(400).json({ error: 'Für diesen Termin ist keine E-Mail-Adresse hinterlegt. Bitte zuerst eintragen oder die Zustimmung telefonisch aufnehmen.' });
    if (t.vorzeitige_leistung === true) return res.status(409).json({ error: 'Die Zustimmung liegt bereits vor.' });
    // Ab VERTRAGSSCHLUSS rechnen, nicht ab heute: Der Vertrag kam am Telefon zustande, der
    // Termin wurde danach angelegt. Wer ab heute rechnet, fragt bei Terminen, deren Frist
    // laengst abgelaufen ist -- und behauptet dabei einen Satz, der nicht stimmt.
    // Ein am TRESEN vereinbarter Termin ist kein Fernabsatzvertrag: Es gibt kein Widerrufsrecht
    // und damit auch nichts zuzustimmen. Eine trotzdem vermerkte "Zustimmung" waere eine
    // Erklaerung zu einem Recht, das der Kunde gar nicht hat -- im Streitfall wertlos und
    // irrefuehrend. Die Oberflaeche zeigt die Knoepfe dort nicht; die Sperre gehoert trotzdem
    // hierher, nicht in die Anzeige.
    if (t.vereinbart_ueber === 'tresen') {
      return res.status(409).json({ error: 'Dieser Termin wurde am Tresen vereinbart — kein Fernabsatz, also kein Widerrufsrecht und keine Zustimmung nötig. Wurde er doch am Telefon vereinbart, ändern Sie das bitte zuerst am Termin.' });
    }
    if (!widerruf.zustimmungNoetigAbVertrag(t.vertrag_tag, t.datum)) {
      return res.status(409).json({ error: 'Der Termin liegt außerhalb der 14-tägigen Widerrufsfrist. Eine Zustimmung ist dafür nicht nötig.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const ablauf = new Date(Date.now() + GUELTIG_TAGE * 86400000);
    await query('UPDATE termine SET zustimmung_token=$1, zustimmung_token_ablauf=$2, zustimmung_angefragt_am=NOW() WHERE id=$3',
      [token, ablauf, t.id]);

    const e = await firmendaten();
    const url = basisUrl(e) + '/api/zustimmung/bestaetigen?token=' + token;
    const leist = (() => {
      let l = t.leistungen; if (typeof l === 'string') { try { l = JSON.parse(l); } catch (x) { l = null; } }
      return (Array.isArray(l) && l.length) ? l.map((p) => p.bezeichnung).filter(Boolean).join(', ') : (t.termin_typ || 'Werkstatttermin');
    })();

    const html = kundenMailHtml(e, {
      titel: 'Bitte bestätigen Sie Ihren Termin',
      anrede: t.anrede, vorname: t.vorname, nachname: t.nachname,
      text: 'wir haben Ihren Termin telefonisch für Sie vorgemerkt:\n\n'
        + datumLang(t.datum) + ' um ' + hm(t.uhrzeit_von) + ' Uhr\n'
        + leist + (t.kennzeichen ? ' · ' + t.kennzeichen : '') + '\n\n'
        + 'Da wir diesen Termin am Telefon vereinbart haben, steht Ihnen ein gesetzliches '
        + 'Widerrufsrecht von vierzehn Tagen zu. Ihr Termin liegt innerhalb dieser Frist — wir '
        + 'würden also tätig werden, bevor sie abgelaufen ist. Dafür benötigen wir Ihre '
        + 'ausdrückliche Zustimmung.\n\n'
        + 'Mit einem Klick auf die Schaltfläche erklären Sie, dass wir den Termin wie vereinbart '
        + 'ausführen dürfen, und bestätigen zugleich, dass Ihnen bekannt ist: Ihr Widerrufsrecht '
        + 'erlischt, sobald die Leistung vollständig erbracht ist.\n\n'
        + 'Möchten Sie das nicht, ist das selbstverständlich in Ordnung. Rufen Sie uns einfach an — '
        + 'dann führen wir den Termin erst nach Ablauf der Frist aus oder vereinbaren einen '
        + 'späteren. Ihr Termin bleibt in jedem Fall bestehen.\n\n'
        + '─────────────────────────────\n\n'
        + belehrung.alsText(e),
      button: { text: 'Termin bestätigen und Ausführung zustimmen', url: url },
      hinweis: 'Dieser Bestätigungslink ist ' + GUELTIG_TAGE + ' Tage gültig. Sie erhalten diese '
        + 'Nachricht, weil Sie mit uns telefonisch einen Termin vereinbart haben.'
    });

    // Scheitert der Versand, darf die Kennung NICHT stehenbleiben: Sonst gaebe es einen
    // gueltigen Bestaetigungslink, den niemand bekommen hat -- und der Betrieb saehe "Zustimmung
    // angefordert", obwohl nie eine Mail hinausging.
    try {
      await sendMail({ to: t.email, subject: 'Bitte bestätigen: Ihr Termin am ' + String(t.datum).slice(0, 10).split('-').reverse().join('.'), html });
    } catch (mailFehler) {
      await query('UPDATE termine SET zustimmung_token=NULL, zustimmung_token_ablauf=NULL, zustimmung_angefragt_am=NULL WHERE id=$1', [t.id]);
      return res.status(502).json({
        error: 'Die Bestätigungsmail konnte nicht versendet werden (' + mailFehler.message +
               '). Bitte später erneut versuchen oder die Zustimmung telefonisch aufnehmen.'
      });
    }
    await auditLog({ userId: req.user.id, aktion: 'termin.zustimmung_angefordert', tabelle: 'termine', datensatzId: t.id });
    res.json({ message: 'Bestätigungsmail an ' + t.email + ' gesendet.' });
  } catch (err) { next(err); }
});

// ── Kunde: Klick aus der Mail ───────────────────────────────────────────────────────────────
router.get('/bestaetigen', linkLimiter, async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).send(seite('Link ungültig', '<p>Dieser Bestätigungslink ist nicht lesbar. Bitte rufen Sie uns kurz an, dann klären wir es direkt.</p>', 'fehler'));
    }
    const t = (await query(
      'SELECT id, datum, uhrzeit_von, vorzeitige_leistung, zustimmung_token_ablauf FROM termine WHERE zustimmung_token=$1',
      [token])).rows[0];
    if (!t) {
      return res.status(404).send(seite('Link nicht mehr gültig',
        '<p>Dieser Link wurde bereits verwendet oder ist abgelaufen.</p>' +
        '<p>Falls Sie unsicher sind, ob Ihre Bestätigung angekommen ist: Rufen Sie uns bitte kurz an.</p>', 'fehler'));
    }
    if (t.vorzeitige_leistung === true) {
      return res.send(seite('Bereits bestätigt', '<p>Ihre Zustimmung liegt uns bereits vor. Sie müssen nichts weiter tun.</p>'));
    }
    if (t.zustimmung_token_ablauf && new Date(t.zustimmung_token_ablauf) < new Date()) {
      return res.status(410).send(seite('Link abgelaufen',
        '<p>Dieser Bestätigungslink ist abgelaufen. Bitte rufen Sie uns kurz an — wir senden Ihnen einen neuen oder nehmen Ihre Zustimmung direkt auf.</p>', 'fehler'));
    }
    // Token wird beim Einloesen geleert: Der Link gilt genau einmal. Die Bedingung steht IM
    // UPDATE, nicht davor: Zwei gleichzeitige Klicks (Mailprogramm laedt den Link vor, Kunde
    // klickt) wuerden sonst beide durch die Vorpruefung kommen und beide schreiben -- der
    // spaetere ueberschriebe Zeitpunkt und IP des ersten, also genau die Beweisangaben.
    const gesetzt = await query(
      `UPDATE termine SET vorzeitige_leistung=true, vorzeitige_leistung_am=NOW(),
         vorzeitige_leistung_ip=$1, vorzeitige_leistung_quelle='mail',
         zustimmung_token=NULL, zustimmung_token_ablauf=NULL
       WHERE id=$2 AND zustimmung_token=$3 AND vorzeitige_leistung=false
       RETURNING id`, [ipVon(req), t.id, token]);
    if (!gesetzt.rows.length) {
      return res.send(seite('Bereits bestätigt', '<p>Ihre Zustimmung liegt uns bereits vor. Sie müssen nichts weiter tun.</p>'));
    }

    res.send(seite('Vielen Dank — Ihr Termin ist bestätigt',
      '<p>Wir haben Ihre Zustimmung notiert und sehen uns am <strong>' + datumLang(t.datum) +
      '</strong> um <strong>' + hm(t.uhrzeit_von) + ' Uhr</strong>.</p>' +
      '<p style="font-size:13px;color:#777">Ihre Erklärung: Sie sind damit einverstanden, dass wir den Termin ' +
      'vor Ablauf Ihrer vierzehntägigen Widerrufsfrist ausführen, und Ihnen ist bekannt, dass Ihr ' +
      'Widerrufsrecht erlischt, sobald die Leistung vollständig erbracht ist. Die Widerrufsbelehrung ' +
      'finden Sie in unserer E-Mail und jederzeit auf unserer Website.</p>'));
  } catch (err) { next(err); }
});

// ── Betrieb: Zustimmung telefonisch aufgenommen ─────────────────────────────────────────────
// Der Kunde hat am Telefon zugestimmt und klickt nichts. Das ist zulaessig — die Zustimmung muss
// ausdruecklich sein, nicht schriftlich. Wer sie aufnimmt, wird namentlich vermerkt: Eine
// Erklaerung ohne erkennbaren Zeugen waere im Streitfall wenig wert.
router.post('/telefonisch/:terminId', authenticate, requireStaff, async (req, res, next) => {
  try {
    const t = (await query(
      `SELECT id, datum, vorzeitige_leistung, vereinbart_ueber,
              to_char(erstellt_am AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS vertrag_tag
         FROM termine WHERE id=$1`, [req.params.terminId])).rows[0];
    if (!t) return res.status(404).json({ error: 'Termin nicht gefunden.' });
    if (t.vorzeitige_leistung === true) return res.status(409).json({ error: 'Die Zustimmung liegt bereits vor.' });
    // Ab VERTRAGSSCHLUSS rechnen, nicht ab heute: Der Vertrag kam am Telefon zustande, der
    // Termin wurde danach angelegt. Wer ab heute rechnet, fragt bei Terminen, deren Frist
    // laengst abgelaufen ist -- und behauptet dabei einen Satz, der nicht stimmt.
    // Ein am TRESEN vereinbarter Termin ist kein Fernabsatzvertrag: Es gibt kein Widerrufsrecht
    // und damit auch nichts zuzustimmen. Eine trotzdem vermerkte "Zustimmung" waere eine
    // Erklaerung zu einem Recht, das der Kunde gar nicht hat -- im Streitfall wertlos und
    // irrefuehrend. Die Oberflaeche zeigt die Knoepfe dort nicht; die Sperre gehoert trotzdem
    // hierher, nicht in die Anzeige.
    if (t.vereinbart_ueber === 'tresen') {
      return res.status(409).json({ error: 'Dieser Termin wurde am Tresen vereinbart — kein Fernabsatz, also kein Widerrufsrecht und keine Zustimmung nötig. Wurde er doch am Telefon vereinbart, ändern Sie das bitte zuerst am Termin.' });
    }
    if (!widerruf.zustimmungNoetigAbVertrag(t.vertrag_tag, t.datum)) {
      return res.status(409).json({ error: 'Der Termin liegt außerhalb der 14-tägigen Widerrufsfrist. Eine Zustimmung ist dafür nicht nötig.' });
    }
    const wer = [req.user.vorname, req.user.nachname].filter(Boolean).join(' ') || req.user.email || 'Mitarbeiter';
    await query(
      `UPDATE termine SET vorzeitige_leistung=true, vorzeitige_leistung_am=NOW(),
         vorzeitige_leistung_quelle=$1, zustimmung_token=NULL, zustimmung_token_ablauf=NULL
       WHERE id=$2`, ['telefonisch durch ' + wer, t.id]);
    await auditLog({ userId: req.user.id, aktion: 'termin.zustimmung_telefonisch', tabelle: 'termine', datensatzId: t.id });
    res.json({ message: 'Telefonische Zustimmung vermerkt.' });
  } catch (err) { next(err); }
});

module.exports = router;
