const router = require('express').Router();
const { query, withTransaction } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const { sendMail } = require('../lib/mailer');
const { kundenMailHtml } = require('../lib/mail-template');

// Oeffnungszeiten als lesbarer Text (aus den synchron gehaltenen Firmendaten-Feldern).
function oeffnungszeilenText(e) {
  const hm = (t) => t ? String(t).substring(0, 5) : '';
  const z = [];
  if (e.mo_fr_von && e.mo_fr_bis) z.push('Mo–Fr ' + hm(e.mo_fr_von) + '–' + hm(e.mo_fr_bis) + ' Uhr');
  if (e.sa_offen && e.sa_von && e.sa_bis) z.push('Sa ' + hm(e.sa_von) + '–' + hm(e.sa_bis) + ' Uhr');
  if (e.so_offen && e.so_von && e.so_bis) z.push('So ' + hm(e.so_von) + '–' + hm(e.so_bis) + ' Uhr');
  return z.join(', ');
}

// Gemeinsamer Kontext (Kunde + Einlagerung + Firmendaten + Platzhalter) fuer alle Einlagerungs-Mails.
async function ladeMailKontext(einlagerungId) {
  const r = (await query(
    `SELECT e.beleg_nr, e.reifen_groesse, e.reifen_typ, e.lagerplatz,
            to_char(e.eingelagert_am,'DD.MM.YYYY') AS eingelagert_am,
            k.anrede, k.vorname, k.nachname, k.email, k.portal_email,
            COALESCE(f.kennzeichen, k.kennzeichen) AS kennzeichen
     FROM einlagerungen e JOIN kunden k ON k.id = e.kunden_id
     LEFT JOIN fahrzeuge f ON f.id = e.fahrzeug_id WHERE e.id=$1`, [einlagerungId])).rows[0];
  if (!r) return null;
  const mail = r.portal_email || r.email;
  if (!mail) return null;
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
  const vars = {
    vorname: r.vorname, nachname: r.nachname, kennzeichen: r.kennzeichen,
    beleg_nr: r.beleg_nr, reifen_typ: r.reifen_typ, reifen_groesse: r.reifen_groesse,
    lagerplatz: r.lagerplatz, eingelagert_am: r.eingelagert_am,
    firmenname: einst.firmenname || 'Schröder & Scholz', telefon: einst.telefon || '',
    portal_url: einst.portal_url || '', oeffnungszeiten: oeffnungszeilenText(einst),
    bewertungslink: einst.google_bewertung_url || ''
  };
  return { mail, r, einst, vars };
}

// Vorlage aus den Einstellungen versenden (best-effort). Fallback-Text, falls das Feld leer ist
// (verhindert stilles Verstummen einer bisher immer versendeten Mail).
async function sendeEinlagerungsMail(einlagerungId, textFeld, typ, titel, betreff, fallback) {
  try {
    const ctx = await ladeMailKontext(einlagerungId);
    if (!ctx) return; // kein Empfaenger
    const html = kundenMailHtml(ctx.einst, {
      anrede: ctx.r.anrede, vorname: ctx.r.vorname, nachname: ctx.r.nachname,
      titel: titel, text: ctx.einst[textFeld] || fallback, vars: ctx.vars
    });
    await sendMail({ to: ctx.mail, subject: betreff(ctx), typ: typ, bezugId: einlagerungId, html: html });
  } catch (e) { console.error('[Mail ' + typ + ']', e.message); }
}

const firmaOf = (ctx) => ctx.einst.firmenname || 'Schröder & Scholz';
async function benachrichtigeEinlagerung(id) {
  return sendeEinlagerungsMail(id, 'email_einlagerung', 'einlagerung', 'Einlagerungsbestätigung',
    (ctx) => 'Ihre Einlagerungsbestätigung — Beleg ' + (ctx.r.beleg_nr || '') + ' — ' + firmaOf(ctx),
    'wir bestätigen die Einlagerung Ihrer Räder (Beleg {beleg_nr}, {kennzeichen}) auf Lagerplatz {lagerplatz}.');
}
async function benachrichtigeAbholbereit(id) {
  return sendeEinlagerungsMail(id, 'email_abholbereit', 'abholbereit', 'Ihre Räder sind abholbereit',
    (ctx) => 'Ihre Räder sind abholbereit' + (ctx.r.kennzeichen ? ' — ' + ctx.r.kennzeichen : '') + ' — ' + firmaOf(ctx),
    'Ihre eingelagerten Räder ({reifen_groesse}) sind abholbereit. Sie können sie zu unseren Öffnungszeiten abholen: {oeffnungszeiten}.');
}
async function benachrichtigeNachziehen(id) {
  return sendeEinlagerungsMail(id, 'email_raeder_nachziehen', 'nachziehen', 'Wichtiger Sicherheitshinweis: Radschrauben nachziehen',
    (ctx) => 'Sicherheitshinweis: Radschrauben nachziehen' + (ctx.r.kennzeichen ? ' — ' + ctx.r.kennzeichen : ''),
    'Bitte lassen Sie die Radschrauben nach den ersten 50 bis 100 gefahrenen Kilometern nachziehen. Zu Ihrer Sicherheit.');
}

router.use(authenticate, requireStaff);

const nextBelegNr = async () => {
  const { rows } = await query("SELECT nextval('seq_beleg_nr') as nr");
  return `E-${String(rows[0].nr).padStart(4,'0')}`;
};

router.get('/statistiken', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM v_statistiken');
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { suche, status, typ, limit = 200, offset = 0 } = req.query;
    let sql = `
      SELECT e.*,
        k.kunden_nr,
        k.vorname || ' ' || k.nachname AS kundenname,
        k.kennzeichen, k.telefon, k.email, k.firma,
        f.kennzeichen AS fahrzeug_kennzeichen, f.marke AS fahrzeug_marke
      FROM einlagerungen e
      JOIN kunden k ON e.kunden_id = k.id
      LEFT JOIN fahrzeuge f ON f.id = e.fahrzeug_id
      WHERE 1=1`;
    const params = [];
    if (status) {
      params.push(status);
      sql += ` AND e.status=$${params.length}`;
    }
    if (typ) {
      params.push(typ);
      sql += ` AND e.reifen_typ=$${params.length}`;
    }
    if (suche) {
      params.push(`%${suche}%`);
      const n = params.length;
      sql += ` AND (k.vorname ILIKE $${n} OR k.nachname ILIKE $${n}
               OR k.kennzeichen ILIKE $${n} OR e.lagerplatz ILIKE $${n}
               OR e.beleg_nr ILIKE $${n} OR e.reifen_groesse ILIKE $${n})`;
    }
    params.push(parseInt(limit));
    sql += ` ORDER BY e.erstellt_am DESC LIMIT $${params.length}`;
    params.push(parseInt(offset));
    sql += ` OFFSET $${params.length}`;
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.*,
         k.kunden_nr,
         k.vorname || ' ' || k.nachname AS kundenname,
         k.kennzeichen, k.telefon, k.email,
         k.strasse, k.plz, k.ort,
         k.fahrzeug_marke, k.fahrzeug_modell
       FROM einlagerungen e
       JOIN kunden k ON e.kunden_id = k.id
       WHERE e.id::text=$1 OR UPPER(e.beleg_nr)=UPPER($1)`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Einlagerung nicht gefunden.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /:id/historie — kompletter Radsatz-Verlauf (Vorgaenger + Folgeeinlagerungen), alt -> neu.
router.get('/:id/historie', async (req, res, next) => {
  try {
    const { rows } = await query(
      `WITH RECURSIVE chain AS (
         SELECT * FROM einlagerungen WHERE id::text=$1
         UNION
         SELECT e.* FROM einlagerungen e
           JOIN chain c ON e.id = c.vorgaenger_id OR e.vorgaenger_id = c.id
       )
       SELECT id, beleg_nr, reifen_groesse, reifen_typ, reifen_marke, reifen_modell,
              profil_vl, profil_vr, profil_hl, profil_hr, dot, anzahl, felgen,
              lagerplatz, status, eingelagert_am, abgeholt_am, vorgaenger_id
       FROM chain
       ORDER BY eingelagert_am ASC, erstellt_am ASC`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Einlagerung nicht gefunden.' });
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { kunden_id, reifen_groesse, reifen_typ, reifen_marke, reifen_modell,
            profil_vl, profil_vr, profil_hl, profil_hr,
            anzahl, felgen, dot, lagerplatz, bemerkungen, fahrzeug_id, vorgaenger_id } = req.body;
    if (!kunden_id || !reifen_groesse || !reifen_typ || !lagerplatz)
      return res.status(400).json({
        error: 'kunden_id, reifen_groesse, reifen_typ und lagerplatz sind Pflicht.'
      });
    // Serverseitige Validierung (verhindert, dass Garbage in die Werkstattdaten gelangt)
    // Format Breite/Verhaeltnis R Zoll (z.B. 205/55 R16 91W) + plausible Wertebereiche (verhindert 000/00 R00 o.ae.)
    const _dm = String(reifen_groesse).match(/^(\d{3})\/(\d{2})\s*[A-Z]{0,2}\s*(\d{2})\s*[0-9A-Z ]*$/i);
    if (!_dm || +_dm[1] < 125 || +_dm[1] > 355 || +_dm[2] < 25 || +_dm[2] > 85 || +_dm[3] < 10 || +_dm[3] > 24)
      return res.status(400).json({ error: 'Reifendimension ungültig (Format z. B. 205/55 R16 91W).' });
    for (const p of [profil_vl, profil_vr, profil_hl, profil_hr]) {
      if (p != null && p !== '' && (isNaN(p) || Number(p) < 0 || Number(p) > 15))
        return res.status(400).json({ error: 'Profiltiefe muss zwischen 0 und 15 mm liegen.' });
    }
    const anz = anzahl == null || anzahl === '' ? 4 : parseInt(anzahl);
    if (isNaN(anz) || anz < 1 || anz > 12)
      return res.status(400).json({ error: 'Anzahl muss zwischen 1 und 12 liegen.' });
    // Lagerplatz normalisieren (trim + Grossschreibung) -> sonst umgehen Leerzeichen/Kleinschreibung die Doppelbelegungssperre
    const lp = String(lagerplatz).trim().toUpperCase();
    if (!lp) return res.status(400).json({ error: 'Lagerplatz erforderlich.' });
    // Pruefung + Insert in einer Transaktion mit Advisory-Lock je Lagerplatz
    // -> verhindert, dass zwei gleichzeitige Einlagerungen denselben Platz belegen.
    const neu = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['lagerplatz:' + lp]);
      const belegt = await client.query(
        "SELECT id FROM einlagerungen WHERE lagerplatz=$1 AND status!='Abgeholt'", [lp]);
      if (belegt.rows.length) { const e = new Error(`Lagerplatz ${lp} ist bereits belegt.`); e.status = 409; throw e; }
      // Vorgaenger (Folgeeinlagerung) nur uebernehmen, wenn er zum selben Kunden gehoert.
      let vg = vorgaenger_id || null;
      if (vg) {
        const chk = await client.query('SELECT id FROM einlagerungen WHERE id=$1 AND kunden_id=$2', [vg, kunden_id]);
        if (!chk.rows.length) vg = null;
      }
      const belegRes = await client.query("SELECT nextval('seq_beleg_nr') AS n");
      const beleg_nr = 'E-' + String(belegRes.rows[0].n).padStart(4, '0');
      const ins = await client.query(
        `INSERT INTO einlagerungen
           (beleg_nr, kunden_id, reifen_groesse, reifen_typ, reifen_marke, reifen_modell,
            profil_vl, profil_vr, profil_hl, profil_hr,
            anzahl, felgen, dot, lagerplatz, bemerkungen, erstellt_von, fahrzeug_id, vorgaenger_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [beleg_nr, kunden_id, reifen_groesse, reifen_typ,
         reifen_marke||null, reifen_modell||null,
         profil_vl||null, profil_vr||null, profil_hl||null, profil_hr||null,
         anz, felgen||'Nein', dot||null,
         lp, bemerkungen||null, req.user.id, fahrzeug_id||null, vg]
      );
      return ins.rows[0];
    });
    await auditLog({ userId: req.user.id, aktion: 'einlagerung.erstellt',
      tabelle: 'einlagerungen', datensatzId: neu.id, neueWerte: neu, req });
    benachrichtigeEinlagerung(neu.id); // Einlagerungsbeleg per E-Mail (best-effort)
    res.status(201).json(neu);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['Eingelagert','Abholbereit','Abgeholt'].includes(status))
      return res.status(400).json({ error: 'Ungültiger Status.' });
    const now = new Date();
    const { rows } = await query(
      `UPDATE einlagerungen SET
         status         = $1,
         abholbereit_am = CASE WHEN $1='Abholbereit' THEN $2 WHEN $1='Eingelagert' THEN NULL ELSE abholbereit_am END,
         abgeholt_am    = CASE WHEN $1='Abgeholt'    THEN $2 WHEN $1 IN ('Eingelagert','Abholbereit') THEN NULL ELSE abgeholt_am END,
         geaendert_von  = $3
       WHERE id::text=$4 OR beleg_nr=$4
       RETURNING *`,
      [status, now, req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    await auditLog({ userId: req.user.id,
      aktion: `einlagerung.status.${status.toLowerCase()}`,
      tabelle: 'einlagerungen', datensatzId: req.params.id,
      neueWerte: { status }, req });
    // Kunde automatisch informieren, sobald die Raeder abholbereit sind
    if (status === 'Abholbereit') benachrichtigeAbholbereit(req.params.id);
    // Nachzieh-Hinweis NUR wenn die Räder tatsächlich montiert wurden (Räderwechsel-Flow setzt montiert=true),
    // nicht bei simpler Abholung eingelagerter Räder.
    if (status === 'Abgeholt' && req.body.montiert === true) benachrichtigeNachziehen(req.params.id);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Lagerplatz einer bestehenden Einlagerung aendern (mit Belegt-Pruefung + Sperre)
router.patch('/:id/lagerplatz', async (req, res, next) => {
  try {
    const { lagerplatz } = req.body;
    if (!lagerplatz || !lagerplatz.trim()) return res.status(400).json({ error: 'Lagerplatz erforderlich.' });
    const lp = lagerplatz.trim().toUpperCase();
    const updated = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['lagerplatz:' + lp]);
      const belegt = await client.query(
        "SELECT id FROM einlagerungen WHERE lagerplatz=$1 AND status!='Abgeholt' AND id<>$2", [lp, req.params.id]);
      if (belegt.rows.length) { const e = new Error(`Lagerplatz ${lp} ist bereits belegt.`); e.status = 409; throw e; }
      const r = await client.query(
        'UPDATE einlagerungen SET lagerplatz=$1, geaendert_von=$2 WHERE id=$3 RETURNING *',
        [lp, req.user.id, req.params.id]);
      return r.rows[0];
    });
    if (!updated) return res.status(404).json({ error: 'Nicht gefunden.' });
    await auditLog({ userId: req.user.id, aktion: 'einlagerung.lagerplatz_geaendert',
      tabelle: 'einlagerungen', datensatzId: req.params.id, neueWerte: { lagerplatz: lp }, req });
    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      "DELETE FROM einlagerungen WHERE id=$1 AND status='Abgeholt' RETURNING id, beleg_nr",
      [req.params.id]
    );
    if (!rows.length)
      return res.status(400).json({
        error: 'Nur abgeholte Einlagerungen können gelöscht werden.'
      });
    await auditLog({ userId: req.user.id, aktion: 'einlagerung.geloescht',
      tabelle: 'einlagerungen', datensatzId: req.params.id, req });
    res.json({ message: 'Gelöscht.' });
  } catch (err) { next(err); }
});

module.exports = router;
