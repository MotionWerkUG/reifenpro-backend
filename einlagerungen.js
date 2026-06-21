const router = require('express').Router();
const { query, withTransaction } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');

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
       WHERE e.id=$1 OR e.beleg_nr=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Einlagerung nicht gefunden.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { kunden_id, reifen_groesse, reifen_typ, reifen_marke, reifen_modell,
            profil_vl, profil_vr, profil_hl, profil_hr,
            anzahl, felgen, dot, lagerplatz, bemerkungen, fahrzeug_id } = req.body;
    if (!kunden_id || !reifen_groesse || !reifen_typ || !lagerplatz)
      return res.status(400).json({
        error: 'kunden_id, reifen_groesse, reifen_typ und lagerplatz sind Pflicht.'
      });
    // Pruefung + Insert in einer Transaktion mit Advisory-Lock je Lagerplatz
    // -> verhindert, dass zwei gleichzeitige Einlagerungen denselben Platz belegen.
    const neu = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['lagerplatz:' + lagerplatz]);
      const belegt = await client.query(
        "SELECT id FROM einlagerungen WHERE lagerplatz=$1 AND status!='Abgeholt'", [lagerplatz]);
      if (belegt.rows.length) { const e = new Error(`Lagerplatz ${lagerplatz} ist bereits belegt.`); e.status = 409; throw e; }
      const belegRes = await client.query("SELECT nextval('seq_beleg_nr') AS n");
      const beleg_nr = 'E-' + String(belegRes.rows[0].n).padStart(4, '0');
      const ins = await client.query(
        `INSERT INTO einlagerungen
           (beleg_nr, kunden_id, reifen_groesse, reifen_typ, reifen_marke, reifen_modell,
            profil_vl, profil_vr, profil_hl, profil_hr,
            anzahl, felgen, dot, lagerplatz, bemerkungen, erstellt_von, fahrzeug_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [beleg_nr, kunden_id, reifen_groesse, reifen_typ,
         reifen_marke||null, reifen_modell||null,
         profil_vl||null, profil_vr||null, profil_hl||null, profil_hr||null,
         anzahl||4, felgen||'Nein', dot||null,
         lagerplatz, bemerkungen||null, req.user.id, fahrzeug_id||null]
      );
      return ins.rows[0];
    });
    await auditLog({ userId: req.user.id, aktion: 'einlagerung.erstellt',
      tabelle: 'einlagerungen', datensatzId: neu.id, neueWerte: neu, req });
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
         abholbereit_am = CASE WHEN $1='Abholbereit' THEN $2 ELSE abholbereit_am END,
         abgeholt_am    = CASE WHEN $1='Abgeholt'    THEN $2 ELSE abgeholt_am    END,
         geaendert_von  = $3
       WHERE id=$4
       RETURNING *`,
      [status, now, req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    await auditLog({ userId: req.user.id,
      aktion: `einlagerung.status.${status.toLowerCase()}`,
      tabelle: 'einlagerungen', datensatzId: req.params.id,
      neueWerte: { status }, req });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Lagerplatz einer bestehenden Einlagerung aendern (mit Belegt-Pruefung + Sperre)
router.patch('/:id/lagerplatz', async (req, res, next) => {
  try {
    const { lagerplatz } = req.body;
    if (!lagerplatz || !lagerplatz.trim()) return res.status(400).json({ error: 'Lagerplatz erforderlich.' });
    const lp = lagerplatz.trim();
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
