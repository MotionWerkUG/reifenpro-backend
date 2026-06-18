const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');

router.use(authenticate, requireStaff);

const nextKundenNr = async () => {
  const { rows } = await query("SELECT nextval('seq_kunden_nr') as nr");
  return `K-${String(rows[0].nr).padStart(4,'0')}`;
};

router.get('/', async (req, res, next) => {
  try {
    const { suche, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT k.*,
        (SELECT COUNT(*) FROM einlagerungen e
         WHERE e.kunden_id=k.id AND e.status!='Abgeholt') AS aktive_einlagerungen
      FROM kunden k
      WHERE k.aktiv=true`;
    const params = [];
    if (suche) {
      params.push(`%${suche}%`);
      sql += ` AND (k.vorname ILIKE $1 OR k.nachname ILIKE $1
               OR k.kennzeichen ILIKE $1 OR k.telefon ILIKE $1
               OR k.kunden_nr ILIKE $1 OR k.email ILIKE $1
               OR EXISTS (SELECT 1 FROM fahrzeuge f WHERE f.kunden_id=k.id AND f.kennzeichen ILIKE $1))`;
    }
    params.push(parseInt(limit));
    sql += ` ORDER BY k.nachname, k.vorname LIMIT $${params.length}`;
    params.push(parseInt(offset));
    sql += ` OFFSET $${params.length}`;
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT k.*,
        (SELECT COUNT(*) FROM einlagerungen e
         WHERE e.kunden_id=k.id AND e.status!='Abgeholt') AS aktive_einlagerungen
       FROM kunden k
       WHERE k.id=$1 OR k.kunden_nr=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { vorname, nachname, telefon, telefon2, email, firma, anrede, ust_id,
            strasse, plz, ort, kennzeichen, fahrzeug_marke,
            fahrzeug_modell, baujahr, notizen, ist_gewerbe, grosskunden_rabatt } = req.body;
    if (!vorname || !nachname || !telefon)
      return res.status(400).json({ error: 'Vorname, Nachname und Telefon sind Pflicht.' });
    // Duplikatpruefung per E-Mail (case-insensitiv); mit force=true ueberschreibbar
    if (email && req.body.force !== true) {
      const dup = await query(
        'SELECT kunden_nr, vorname, nachname FROM kunden WHERE LOWER(email)=LOWER($1) AND aktiv=true',
        [email]
      );
      if (dup.rows.length) {
        return res.status(409).json({
          code: 'EMAIL_EXISTS',
          error: 'Es gibt bereits einen Kunden mit dieser E-Mail: ' + dup.rows[0].vorname + ' ' + dup.rows[0].nachname + ' (' + dup.rows[0].kunden_nr + '). Trotzdem anlegen?'
        });
      }
    }
    const kunden_nr = await nextKundenNr();
    const { rows } = await query(
      `INSERT INTO kunden
         (kunden_nr,vorname,nachname,telefon,telefon2,email,firma,anrede,ust_id,
          strasse,plz,ort,kennzeichen,fahrzeug_marke,fahrzeug_modell,
          baujahr,notizen,ist_gewerbe,grosskunden_rabatt,erstellt_von)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [kunden_nr, vorname.trim(), nachname.trim(), telefon.trim(),
       telefon2||null, email||null, firma||null, anrede||null, ust_id||null,
       strasse||null, plz||null, ort||null,
       kennzeichen ? kennzeichen.toUpperCase().trim() : null,
       fahrzeug_marke||null, fahrzeug_modell||null,
       baujahr||null, notizen||null,
       ist_gewerbe === true, parseInt(grosskunden_rabatt) || 0, req.user.id]
    );
    await auditLog({ userId: req.user.id, aktion: 'kunden.erstellt',
      tabelle: 'kunden', datensatzId: rows[0].id, neueWerte: rows[0], req });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { rows: old } = await query('SELECT * FROM kunden WHERE id=$1', [req.params.id]);
    if (!old.length) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    const o = old[0];
    const { rows } = await query(
      `UPDATE kunden SET
         vorname=$1, nachname=$2, telefon=$3, telefon2=$4,
         email=$5, firma=$6, strasse=$7, plz=$8, ort=$9,
         kennzeichen=$10, fahrzeug_marke=$11, fahrzeug_modell=$12,
         baujahr=$13, notizen=$14, aktiv=$15, ist_gewerbe=$16, grosskunden_rabatt=$17,
         anrede=$18, ust_id=$19
       WHERE id=$20 RETURNING *`,
      [req.body.vorname       || o.vorname,
       req.body.nachname      || o.nachname,
       req.body.telefon       || o.telefon,
       req.body.telefon2      !== undefined ? req.body.telefon2      : o.telefon2,
       req.body.email         !== undefined ? req.body.email         : o.email,
       req.body.firma         !== undefined ? req.body.firma         : o.firma,
       req.body.strasse       !== undefined ? req.body.strasse       : o.strasse,
       req.body.plz           !== undefined ? req.body.plz           : o.plz,
       req.body.ort           !== undefined ? req.body.ort           : o.ort,
       req.body.kennzeichen   ? req.body.kennzeichen.toUpperCase() : o.kennzeichen,
       req.body.fahrzeug_marke  !== undefined ? req.body.fahrzeug_marke  : o.fahrzeug_marke,
       req.body.fahrzeug_modell !== undefined ? req.body.fahrzeug_modell : o.fahrzeug_modell,
       req.body.baujahr       !== undefined ? req.body.baujahr       : o.baujahr,
       req.body.notizen       !== undefined ? req.body.notizen       : o.notizen,
       req.body.aktiv         !== undefined ? req.body.aktiv         : o.aktiv,
       req.body.ist_gewerbe   !== undefined ? (req.body.ist_gewerbe === true) : o.ist_gewerbe,
       req.body.grosskunden_rabatt !== undefined ? (parseInt(req.body.grosskunden_rabatt) || 0) : o.grosskunden_rabatt,
       req.body.anrede !== undefined ? req.body.anrede : o.anrede,
       req.body.ust_id !== undefined ? req.body.ust_id : o.ust_id,
       req.params.id]
    );
    await auditLog({ userId: req.user.id, aktion: 'kunden.geaendert',
      tabelle: 'kunden', datensatzId: req.params.id,
      alteWerte: o, neueWerte: rows[0], req });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id/einlagerungen', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM einlagerungen WHERE kunden_id=$1 ORDER BY erstellt_am DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── FAHRZEUGE (Standort pflegt Fahrzeuge eines Kunden) ──
const FAHRZEUG_TYPEN = ['PKW', 'SUV', 'Transporter', 'Motorrad', 'Sonstiges'];

// Spiegelt das zuletzt gepflegte Fahrzeug in die Kunden-Stammfelder (fuer Suche/Profil/Buchung/HU-Warnung)
async function syncPrimaerFahrzeug(kundenId, fz) {
  if (!fz) return;
  await query(
    'UPDATE kunden SET kennzeichen=$1, fahrzeug_marke=$2, fahrzeug_modell=$3, hu_datum=COALESCE($4, hu_datum) WHERE id=$5',
    [fz.kennzeichen || null, fz.marke || null, fz.modell || null, fz.hu_datum || null, kundenId]
  );
}

router.get('/:id/fahrzeuge', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM fahrzeuge WHERE kunden_id=$1 ORDER BY erstellt_am', [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:id/fahrzeuge', async (req, res, next) => {
  try {
    const { typ, marke, modell, kennzeichen, baujahr, hu_datum, notiz } = req.body;
    if (!marke || !modell || !kennzeichen) return res.status(400).json({ error: 'Kennzeichen, Marke und Modell sind Pflicht.' });
    const t = FAHRZEUG_TYPEN.includes(typ) ? typ : 'PKW';
    const { rows } = await query(
      `INSERT INTO fahrzeuge (kunden_id, typ, marke, modell, kennzeichen, baujahr, hu_datum, notiz)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, t, marke || null, modell || null, kennzeichen ? kennzeichen.toUpperCase() : null, baujahr ? parseInt(baujahr) : null, hu_datum || null, notiz || null]
    );
    await syncPrimaerFahrzeug(req.params.id, rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id/fahrzeuge/:fid', async (req, res, next) => {
  try {
    const { typ, marke, modell, kennzeichen, baujahr, hu_datum, notiz } = req.body;
    if (!marke || !modell || !kennzeichen) return res.status(400).json({ error: 'Kennzeichen, Marke und Modell sind Pflicht.' });
    const t = FAHRZEUG_TYPEN.includes(typ) ? typ : 'PKW';
    const { rows } = await query(
      `UPDATE fahrzeuge SET typ=$1, marke=$2, modell=$3, kennzeichen=$4, baujahr=$5, hu_datum=$6, notiz=$7, geaendert_am=NOW()
       WHERE id=$8 AND kunden_id=$9 RETURNING *`,
      [t, marke || null, modell || null, kennzeichen ? kennzeichen.toUpperCase() : null, baujahr ? parseInt(baujahr) : null, hu_datum || null, notiz || null, req.params.fid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Fahrzeug nicht gefunden.' });
    await syncPrimaerFahrzeug(req.params.id, rows[0]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id/fahrzeuge/:fid', async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM fahrzeuge WHERE id=$1 AND kunden_id=$2 RETURNING id', [req.params.fid, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Fahrzeug nicht gefunden.' });
    res.json({ message: 'Gelöscht.' });
  } catch (err) { next(err); }
});

// ── Gewerbe-Konditionen: Pauschalrabatt + feste Preise je Leistung ──
router.get('/:id/konditionen', async (req, res, next) => {
  try {
    const k = (await query('SELECT ist_gewerbe, grosskunden_rabatt FROM kunden WHERE id=$1', [req.params.id])).rows[0];
    if (!k) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    const preise = (await query(
      'SELECT kp.artikel_id, kp.preis, a.name AS artikel_name FROM kunden_preise kp JOIN artikel a ON a.id=kp.artikel_id WHERE kp.kunden_id=$1 ORDER BY a.name',
      [req.params.id])).rows;
    res.json({ ist_gewerbe: k.ist_gewerbe, grosskunden_rabatt: k.grosskunden_rabatt || 0, preise });
  } catch (err) { next(err); }
});
router.put('/:id/konditionen', async (req, res, next) => {
  try {
    const k = (await query('SELECT id FROM kunden WHERE id=$1', [req.params.id])).rows[0];
    if (!k) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    if (req.body.grosskunden_rabatt !== undefined) {
      var rab = parseInt(req.body.grosskunden_rabatt) || 0; if (rab < 0) rab = 0; if (rab > 100) rab = 100;
      await query('UPDATE kunden SET grosskunden_rabatt=$1 WHERE id=$2', [rab, req.params.id]);
    }
    if (Array.isArray(req.body.preise)) {
      await query('DELETE FROM kunden_preise WHERE kunden_id=$1', [req.params.id]);
      for (const p of req.body.preise) {
        if (p.artikel_id && p.preis != null && p.preis !== '' && !isNaN(parseFloat(p.preis)))
          await query('INSERT INTO kunden_preise (kunden_id, artikel_id, preis) VALUES ($1,$2,$3) ON CONFLICT (kunden_id, artikel_id) DO UPDATE SET preis=EXCLUDED.preis',
            [req.params.id, p.artikel_id, parseFloat(p.preis)]);
      }
    }
    res.json({ message: 'Konditionen gespeichert.' });
  } catch (err) { next(err); }
});

// Werbe-/Saison-Einwilligung: Re-Bestaetigung (Double-Opt-in) anfordern fuer alle, die zugestimmt,
// aber noch nicht bestaetigt haben. Reine Mail-Aktion; loescht/aendert KEINE Kundendaten.
router.post('/einwilligung-reconfirm', async (req, res, next) => {
  try {
    const einst = (await query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
    const { rows } = await query(
      `SELECT id, vorname, nachname, anrede, COALESCE(email, portal_email) AS email
       FROM kunden
       WHERE einwilligung_saison_erinnerung = true AND einwilligung_saison_bestaetigt IS NOT TRUE
         AND COALESCE(email, portal_email) IS NOT NULL AND aktiv = true`);
    const { sendeDoi } = require('../lib/einwilligung');
    let gesendet = 0;
    for (const k of rows) {
      try { if (await sendeDoi(k, einst)) gesendet++; } catch (e) { console.error('[Reconfirm]', e.message); }
    }
    await auditLog({ userId: req.user.id, aktion: 'einwilligung.reconfirm', tabelle: 'kunden', datensatzId: null, neueWerte: { angeschrieben: gesendet }, req });
    res.json({ message: gesendet + ' Bestätigungs-E-Mail(s) versendet (' + rows.length + ' Kandidaten).', gesendet: gesendet });
  } catch (e) { next(e); }
});

module.exports = router;
