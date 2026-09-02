'use strict';
const express = require('express');
const router = express.Router();
const { query } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { portalMailHtml, anredeGruss } = require('../lib/mail-template');
const { auditLog } = require('../middleware/errorHandler');

// Alle Termin-Routen sind rein intern (Admin/Werkstatt) — Personal-Rechte erzwingen.
router.use(authenticate, requireStaff);

// ── GET /api/termine ── Admin: alle Termine
router.get('/', async (req, res, next) => {
  try {
    const { von, bis, status, unbestaetigt } = req.query;
    // einlagerung_gebucht: hat der Kunde die Einlagerung selbst mitgebucht? Steckt entweder als
    // Hauptleistung (artikel_id) oder als Position in leistungen (Gast-/Portal-Buchung).
    // einlagern bleibt die ausdrueckliche Entscheidung des Betriebs: NULL = noch keine getroffen.
    let sql = `SELECT t.*,
      k.vorname || ' ' || k.nachname as kundenname,
      COALESCE(t.kennzeichen, k.kennzeichen) AS kennzeichen, k.telefon,
      a.name as artikel_name, a.dauer_minuten,
      f.marke as fahrzeug_marke, f.modell as fahrzeug_modell,
      (COALESCE(a.name ILIKE '%einlagerung%', false)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(t.leistungen,'[]'::jsonb)) p
                   WHERE p->>'bezeichnung' ILIKE '%einlagerung%')) AS einlagerung_gebucht
      FROM termine t
      LEFT JOIN kunden k ON k.id = t.kunden_id
      LEFT JOIN artikel a ON a.id = t.artikel_id
      LEFT JOIN fahrzeuge f ON f.id = t.fahrzeug_id
      WHERE 1=1`;
    const params = [];
    if (von) { params.push(von); sql += ` AND t.datum >= $${params.length}`; }
    if (bis) { params.push(bis); sql += ` AND t.datum <= $${params.length}`; }
    if (status) { params.push(status); sql += ` AND t.status = $${params.length}`; }
    // Eine Gast-Buchung ist erst ein Termin, wenn der Kunde den Link in seiner Mail geklickt hat.
    // Vorher gehoert sie weder aufs Werkstattbrett noch in den Kalender (sie blockiert auch keinen
    // Slot, siehe gast.js). Mit ?unbestaetigt=1 laesst sie sich gezielt abrufen — damit ein Anruf
    // "ich habe doch gebucht" beantwortbar bleibt.
    const nurUnbestaetigt = unbestaetigt === '1' || unbestaetigt === 'true';
    if (nurUnbestaetigt) {
      // Auch abgelaufene Anfragen zeigen — sie sollen auffindbar bleiben, nur eben hier und
      // nicht im Kalender. Das Ablaufdatum steuert die Loeschung, nicht die Sichtbarkeit.
      sql += ` AND t.status='angefragt' AND t.bestaetigung_token IS NOT NULL`;
    } else {
      sql += ` AND NOT (t.status='angefragt' AND t.bestaetigung_token IS NOT NULL)`;
    }
    sql += ' ORDER BY t.datum, t.uhrzeit_von';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// ── GET /api/termine/statistik ── Monatsauslastung
router.get('/statistik', async (req, res, next) => {
  try {
    const { jahr } = req.query;
    const j = parseInt(jahr) || new Date().getFullYear();
    const { rows } = await query(
      `SELECT
        EXTRACT(MONTH FROM datum) as monat,
        COUNT(CASE WHEN status NOT IN ('storniert','abgesagt','nicht_erschienen') THEN 1 END) as anzahl,
        COUNT(CASE WHEN status IN ('storniert','abgesagt','nicht_erschienen') THEN 1 END) as storniert,
        COUNT(CASE WHEN portal_buchung=true AND status NOT IN ('storniert','abgesagt','nicht_erschienen') THEN 1 END) as online
       FROM termine
       WHERE EXTRACT(YEAR FROM datum) = $1
         -- Gleiche Regel wie in der Terminliste: eine Gast-Buchung ohne geklickten
         -- Bestaetigungslink ist noch kein Termin und darf die Auslastung nicht aufblaehen.
         AND NOT (status='angefragt' AND bestaetigung_token IS NOT NULL)
       GROUP BY monat ORDER BY monat`,
      [j]
    );
    // Alle 12 Monate ausgeben (auch leere)
    const monate = Array.from({ length: 12 }, (_, i) => {
      const found = rows.find(r => parseInt(r.monat) === i + 1);
      return { monat: i + 1, anzahl: found ? parseInt(found.anzahl) : 0, storniert: found ? parseInt(found.storniert) : 0, online: found ? parseInt(found.online) : 0 };
    });
    res.json({ jahr: j, monate });
  } catch (e) { next(e); }
});

// ── GET /api/termine/betriebsurlaub ──
router.get('/betriebsurlaub', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM betriebsurlaub ORDER BY von_datum');
    res.json(rows);
  } catch (e) { next(e); }
});

// ── POST /api/termine/betriebsurlaub ──
router.post('/betriebsurlaub', async (req, res, next) => {
  try {
    const { von_datum, bis_datum, beschreibung } = req.body;
    if (!von_datum || !bis_datum) return res.status(400).json({ error: 'Von und Bis erforderlich' });
    const { rows } = await query(
      'INSERT INTO betriebsurlaub (von_datum, bis_datum, beschreibung) VALUES ($1,$2,$3) RETURNING *',
      [von_datum, bis_datum, beschreibung || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ── DELETE /api/termine/betriebsurlaub/:id ──
router.delete('/betriebsurlaub/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM betriebsurlaub WHERE id=$1', [req.params.id]);
    res.json({ message: 'Gelöscht' });
  } catch (e) { next(e); }
});

// ── GET /api/termine/:id ──
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.*, k.vorname || ' ' || k.nachname as kundenname, COALESCE(t.kennzeichen, k.kennzeichen) AS kennzeichen, k.telefon, a.name as artikel_name, a.dauer_minuten
       FROM termine t LEFT JOIN kunden k ON k.id=t.kunden_id LEFT JOIN artikel a ON a.id=t.artikel_id
       WHERE t.id=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── POST /api/termine ── Admin: Termin anlegen
// Sucht Termine, die sich mit der angefragten Zeit ueberschneiden. Bewusst NUR eine
// Warnung, keine Sperre: Es gibt gute Gruende fuer zwei Termine zur selben Zeit — der eine
// Kunde bringt nur die Raeder vorbei, der andere wartet. Ein Verbot wuerde den Betrieb in
// der eigenen Werkstatt behindern. Der oeffentliche Buchungsweg bleibt dagegen hart
// gesperrt, dort entscheidet niemand mit Sachkenntnis.
async function terminKonflikte(datum, von, bis, ausserId) {
  const { rows } = await query(
    `SELECT t.id, t.uhrzeit_von, t.uhrzeit_bis, t.termin_typ,
            COALESCE(NULLIF(btrim(k.vorname || ' ' || k.nachname), ''), t.kontakt_name, 'Laufkundschaft') AS wer
       FROM termine t LEFT JOIN kunden k ON k.id = t.kunden_id
      WHERE t.datum = $1
        AND t.status NOT IN ('storniert', 'abgesagt', 'nicht_erschienen')
        AND ($4::uuid IS NULL OR t.id <> $4::uuid)
        AND t.uhrzeit_von < $3::time AND t.uhrzeit_bis > $2::time
      ORDER BY t.uhrzeit_von`,
    [datum, von, bis, ausserId || null]);
  return rows;
}

router.post('/', async (req, res, next) => {
  try {
    const { kunden_id, kontakt_name, kontakt_telefon, kontakt_email, datum, uhrzeit_von, uhrzeit_bis, termin_typ, artikel_id, kennzeichen, beschreibung, notizen_intern, fahrzeug_id, trotzdem } = req.body;
    if (!datum || !uhrzeit_von || !uhrzeit_bis) return res.status(400).json({ error: 'Datum und Uhrzeiten erforderlich' });
    if (trotzdem !== true) {
      const konflikte = await terminKonflikte(datum, uhrzeit_von, uhrzeit_bis, null);
      if (konflikte.length) {
        return res.status(409).json({
          error: 'Zu dieser Zeit ist bereits etwas eingetragen.',
          konflikt: true,
          termine: konflikte.map((k) => ({
            id: k.id,
            zeit: String(k.uhrzeit_von).substring(0, 5) + '–' + String(k.uhrzeit_bis).substring(0, 5),
            wer: k.wer,
            leistung: k.termin_typ || 'ohne Angabe',
          })),
        });
      }
    }
    const { rows } = await query(
      `INSERT INTO termine (kunden_id, kontakt_name, kontakt_telefon, kontakt_email, datum, uhrzeit_von, uhrzeit_bis, termin_typ, artikel_id, kennzeichen, beschreibung, notizen_intern, fahrzeug_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'bestaetigt') RETURNING *`,
      [kunden_id || null, kontakt_name || null, kontakt_telefon || null, kontakt_email || null, datum, uhrzeit_von, uhrzeit_bis, termin_typ || null, artikel_id || null, kennzeichen || null, beschreibung || null, notizen_intern || null, fahrzeug_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ── PUT /api/termine/:id ──
router.put('/:id', async (req, res, next) => {
  try {
    const { datum, uhrzeit_von, uhrzeit_bis, termin_typ, artikel_id, kennzeichen, beschreibung, notizen_intern, status, kunden_id, kontakt_name, kontakt_telefon, trotzdem } = req.body;
    // Verschieben ist derselbe Fall wie Neuanlegen: Wer einen Termin auf eine belegte Zeit
    // zieht, soll es sehen. Der eigene Termin zaehlt dabei nicht als Konflikt.
    if (trotzdem !== true && datum && uhrzeit_von && uhrzeit_bis) {
      const konflikte = await terminKonflikte(datum, uhrzeit_von, uhrzeit_bis, req.params.id);
      if (konflikte.length) {
        return res.status(409).json({
          error: 'Zu dieser Zeit ist bereits etwas eingetragen.',
          konflikt: true,
          termine: konflikte.map((k) => ({
            id: k.id,
            zeit: String(k.uhrzeit_von).substring(0, 5) + '–' + String(k.uhrzeit_bis).substring(0, 5),
            wer: k.wer,
            leistung: k.termin_typ || 'ohne Angabe',
          })),
        });
      }
    }
    const { rows } = await query(
      `UPDATE termine SET datum=$1, uhrzeit_von=$2, uhrzeit_bis=$3, termin_typ=$4, artikel_id=$5,
       kennzeichen=$6, beschreibung=$7, notizen_intern=$8, status=COALESCE($9, status),
       kunden_id=$11, kontakt_name=$12, kontakt_telefon=$13, geaendert_am=NOW()
       WHERE id=$10 RETURNING *`,
      [datum, uhrzeit_von, uhrzeit_bis, termin_typ, artikel_id || null, kennzeichen, beschreibung, notizen_intern, status || null, req.params.id,
       kunden_id || null, kontakt_name || null, kontakt_telefon || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── PATCH /api/termine/:id/status ── nur Status setzen (z.B. Werkstatt: erledigt)
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const erlaubt = ['angefragt', 'bestaetigt', 'abgeschlossen', 'storniert', 'nicht_erschienen'];
    if (!erlaubt.includes(status)) return res.status(400).json({ error: 'Ungültiger Status.' });
    // Storno-Metadaten konsistent setzen (wie im DELETE-Pfad); Reaktivierung raeumt sie wieder ab
    const { rows } = await query(
      `UPDATE termine SET status=$1, geaendert_am=NOW(),
         storniert_am  = CASE WHEN $1='storniert' THEN COALESCE(storniert_am, NOW())   ELSE NULL END,
         storniert_von = CASE WHEN $1='storniert' THEN COALESCE(storniert_von, 'admin') ELSE NULL END
       WHERE id=$2 RETURNING *`,
      [status, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── DELETE /api/termine/:id ── Admin: Termin absagen
router.delete('/:id', async (req, res, next) => {
  try {
    const { grund } = req.body || {};
    const termin = await query('SELECT t.*, k.portal_email, k.vorname FROM termine t LEFT JOIN kunden k ON k.id=t.kunden_id WHERE t.id=$1', [req.params.id]);
    if (!termin.rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
    const t = termin.rows[0];
    if (t.status === 'storniert') return res.json({ message: 'Termin war bereits abgesagt' });
    await query("UPDATE termine SET status='storniert', storniert_am=COALESCE(storniert_am, NOW()), storniert_von=COALESCE(storniert_von, 'admin') WHERE id=$1", [req.params.id]);
    // Kunden informieren falls Portal-Buchung
    if (t.portal_buchung && t.portal_email) {
      const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      const datumF = new Date(t.datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      await transporter.sendMail({
        from: '"' + (einst.firmenname || 'ReifenPro') + '" <' + process.env.SMTP_USER + '>',
        to: t.portal_email,
        subject: 'Termin abgesagt — ' + datumF,
        html: '<p>Hallo ' + (t.vorname || '') + ',</p><p>Ihr Termin am ' + datumF + ' um ' + t.uhrzeit_von + ' Uhr muss leider abgesagt werden.' + (grund ? '<br>Grund: ' + grund : '') + '</p><p>Bitte buchen Sie einen neuen Termin oder rufen Sie uns an: ' + (einst.telefon || '') + '</p>'
      }).catch(() => {});
    }
    res.json({ message: 'Termin abgesagt' });
  } catch (e) { next(e); }
});

// ── POST /api/termine/portal-freigabe/:kundenId ── Kunde freigeben
router.post('/portal-freigabe/:kundenId', async (req, res, next) => {
  try {
    // Nur freigeben, wenn der Kunde seine E-Mail bestaetigt hat: sonst schaltet der Betrieb einen
    // Zugang frei, dessen Adresse nie jemand nachgewiesen hat (Konto-Uebernahme durch Vertipper
    // oder Fremdregistrierung). Und nur EINMAL: ein zweiter Klick darf keine zweite
    // Willkommensmail beim Kunden ausloesen (WHERE portal_freigegeben=false).
    const { rows } = await query(
      `UPDATE kunden SET portal_freigegeben=true, geaendert_am=NOW()
       WHERE id=$1 AND portal_freigegeben=false AND portal_email_bestaetigt=true
       RETURNING vorname, nachname, anrede, portal_email`,
      [req.params.kundenId]
    );
    if (!rows.length) {
      const ist = (await query('SELECT portal_aktiv, portal_freigegeben, portal_email_bestaetigt FROM kunden WHERE id=$1', [req.params.kundenId])).rows[0];
      if (!ist) return res.status(404).json({ error: 'Kunde nicht gefunden' });
      if (ist.portal_freigegeben) return res.json({ message: 'Portalzugang war bereits freigeschaltet.', bereits_freigegeben: true });
      return res.status(409).json({
        error: 'Der Kunde hat seine E-Mail-Adresse noch nicht bestätigt. Freischalten ist erst danach möglich.',
        wartet_auf_kunden: true
      });
    }
    const k = rows[0];
    // Willkommens-E-Mail
    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    const portalUrl = einst.portal_url || 'http://161.97.187.239/reifenpro/portal/';
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await transporter.sendMail({
      from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>',
      to: k.portal_email,
      subject: 'Ihr Kundenportal ist freigeschaltet — Schröder & Scholz',
      html: portalMailHtml(einst, {
        titel: 'Ihr Kundenportal ist freigeschaltet',
        gruss: anredeGruss(k.anrede, k.vorname, k.nachname),
        absaetze: [
          'Ihr Zugang zum Kundenportal von Schröder &amp; Scholz ist ab sofort freigeschaltet.',
          'Sie können sich jetzt anmelden, Ihre eingelagerten Räder einsehen und bequem online Ihre Termine buchen.'
        ],
        button: { text: 'Zum Kundenportal', url: portalUrl }
      })
    }).catch(() => {});
    await auditLog({ userId: req.user.id, aktion: 'kunde.portal_freigegeben', tabelle: 'kunden', datensatzId: req.params.kundenId, req });
    res.json({ message: 'Portal freigeschaltet, Willkommens-E-Mail gesendet.' });
  } catch (e) { next(e); }
});

// ── PATCH /api/termine/:id/kunde ── Termin nachtraeglich mit einem Kunden verknuepfen
// (z.B. wenn aus einer Online-Buchung ohne Konto im Admin ein Kunde angelegt wurde).
router.patch('/:id/kunde', async (req, res, next) => {
  try {
    const { kunden_id } = req.body || {};
    if (!kunden_id) return res.status(400).json({ error: 'kunden_id erforderlich.' });
    const { rows } = await query('UPDATE termine SET kunden_id=$1, geaendert_am=NOW() WHERE id=$2 RETURNING id', [kunden_id, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Termin nicht gefunden.' });
    res.json({ message: 'ok' });
  } catch (e) { next(e); }
});

// ── PATCH /api/termine/:id/einlagern ── Buero markiert einen Termin fuer Einlagerung,
// damit die Werkstatt es sofort sieht (Buero entscheidet -> Werkstatt wird informiert).
router.patch('/:id/einlagern', async (req, res, next) => {
  try {
    // true = vormerken, false = ausdruecklich zurueckziehen (auch wenn der Kunde die Einlagerung
    // gebucht hat). NULL bleibt der Zustand "noch nicht entschieden" und wird hier nie gesetzt.
    const einlagern = req.body && (req.body.einlagern === true || req.body.einlagern === 'true');
    const { rows } = await query('UPDATE termine SET einlagern=$1, geaendert_am=NOW() WHERE id=$2 RETURNING id, einlagern', [einlagern, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Termin nicht gefunden.' });
    res.json({ message: 'ok', einlagern: rows[0].einlagern });
  } catch (e) { next(e); }
});

// ── PATCH /api/termine/:id/fakturiert ── Termin als abgerechnet markieren (verschwindet aus 'Abzurechnen').
router.patch('/:id/fakturiert', async (req, res, next) => {
  try {
    const fakturiert = !(req.body && (req.body.fakturiert === false || req.body.fakturiert === 'false'));
    // Ein abgesagter oder nicht wahrgenommener Termin kann nicht abgerechnet worden sein.
    // Ohne diese Pruefung liess er sich als fakturiert markieren und verschwand still aus
    // der Liste "Abzurechnen" — die Gegenrichtung (Absage trotz Rechnung) ist im Gast-Weg
    // bereits gesperrt. Das Zuruecknehmen (fakturiert=false) bleibt immer erlaubt.
    const OFFEN_UNMOEGLICH = ['storniert', 'abgesagt', 'nicht_erschienen'];
    if (fakturiert) {
      const ist = (await query('SELECT status FROM termine WHERE id=$1', [req.params.id])).rows[0];
      if (!ist) return res.status(404).json({ error: 'Termin nicht gefunden.' });
      if (OFFEN_UNMOEGLICH.includes(ist.status))
        return res.status(409).json({ error: 'Ein abgesagter Termin kann nicht als abgerechnet markiert werden.' });
    }
    const { rows } = await query('UPDATE termine SET fakturiert=$1 WHERE id=$2 RETURNING id, fakturiert', [fakturiert, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Termin nicht gefunden.' });
    res.json({ message: 'ok', fakturiert: rows[0].fakturiert });
  } catch (e) { next(e); }
});

module.exports = router;
