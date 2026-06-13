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
               OR k.kunden_nr ILIKE $1 OR k.email ILIKE $1)`;
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
    const { vorname, nachname, telefon, telefon2, email, firma,
            strasse, plz, ort, kennzeichen, fahrzeug_marke,
            fahrzeug_modell, baujahr, notizen } = req.body;
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
         (kunden_nr,vorname,nachname,telefon,telefon2,email,firma,
          strasse,plz,ort,kennzeichen,fahrzeug_marke,fahrzeug_modell,
          baujahr,notizen,erstellt_von)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [kunden_nr, vorname.trim(), nachname.trim(), telefon.trim(),
       telefon2||null, email||null, firma||null,
       strasse||null, plz||null, ort||null,
       kennzeichen ? kennzeichen.toUpperCase().trim() : null,
       fahrzeug_marke||null, fahrzeug_modell||null,
       baujahr||null, notizen||null, req.user.id]
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
         baujahr=$13, notizen=$14, aktiv=$15, geaendert_von=$16
       WHERE id=$17 RETURNING *`,
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
       req.user.id, req.params.id]
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

module.exports = router;
