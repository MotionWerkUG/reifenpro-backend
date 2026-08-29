const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const { pruefeAnschrift, pruefeKundentyp, pruefeRechnungEmail, ohneGeheimnisse } = require('../lib/kundendaten');

// Deutsches Kennzeichen pruefen/normalisieren (z. B. WOR-AB-1234, optional E/H). Leeres Feld erlaubt.
function normKennzeichen(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, wert: null };
  const w = String(raw).toUpperCase().replace(/\s+/g, ' ').trim();
  if (!/^[A-ZÄÖÜ]{1,3}-[A-Z]{1,2}-\d{1,4} ?[EH]?$/.test(w)) return { ok: false };
  return { ok: true, wert: w };
}

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
    res.json(ohneGeheimnisse(rows));
  } catch (err) { next(err); }
});

// ── GET /dokumente-faellig ── Kunden mit aktiver Einlagerung, deren Datenschutz/Vertrag fehlt oder abgelaufen ist
// (muss VOR '/:id' stehen, sonst wuerde 'dokumente-faellig' als :id interpretiert)
router.get('/dokumente-faellig', async (req, res, next) => {
  try {
    const e = (await query('SELECT dok_ds_version, dok_vertrag_version FROM einstellungen LIMIT 1')).rows[0] || {};
    const today = new Date().toISOString().substring(0, 10);
    const aktive = (await query(
      `SELECT DISTINCT k.id, k.kunden_nr, k.vorname, k.nachname
       FROM kunden k JOIN einlagerungen e ON e.kunden_id=k.id AND e.status<>'Abgeholt'
       WHERE k.aktiv=true`)).rows;
    if (!aktive.length) return res.json([]);
    const ids = aktive.map((k) => k.id);
    const docs = (await query(
      `SELECT DISTINCT ON (kunden_id, typ) kunden_id, typ, version, gueltig_bis,
              (unterschrift_kunde IS NOT NULL) AS signed
       FROM kunden_dokumente WHERE kunden_id = ANY($1::uuid[]) AND typ IN ('datenschutzerklaerung','einlagerungsvertrag')
       ORDER BY kunden_id, typ, erstellt_am DESC`, [ids])).rows;
    const byK = {}; docs.forEach((d) => { (byK[d.kunden_id] = byK[d.kunden_id] || {})[d.typ] = d; });
    function grund(d, sollVer, zeitpruefung) {
      if (!d || !d.signed) return 'fehlt';
      if ((d.version || null) !== (sollVer || null)) return 'abgelaufen (Textänderung)';
      if (zeitpruefung && d.gueltig_bis && String(d.gueltig_bis).substring(0, 10) < today) return 'abgelaufen (Frist)';
      return null;
    }
    const out = [];
    aktive.forEach((k) => {
      const m = byK[k.id] || {};
      const name = (k.vorname + ' ' + k.nachname).trim();
      const gDs = grund(m['datenschutzerklaerung'], e.dok_ds_version, true);
      const gV = grund(m['einlagerungsvertrag'], e.dok_vertrag_version, false);
      if (gDs) out.push({ kunden_id: k.id, kunden_nr: k.kunden_nr, name: name, typ: 'datenschutzerklaerung', dokument: 'Datenschutzerklärung', grund: gDs });
      if (gV) out.push({ kunden_id: k.id, kunden_nr: k.kunden_nr, name: name, typ: 'einlagerungsvertrag', dokument: 'Einlagerungsvertrag', grund: gV });
    });
    // Einlagerungs- und Auslagerungsscheine haengen am VORGANG, nicht am Kunden: ein Kunde mit
    // fuenf Einlagerungen braucht fuenf unterschriebene Scheine. Deshalb hier je Einlagerung
    // pruefen, ob ein unterschriebener Schein existiert — sonst gilt er nach dem ersten als
    // erledigt, und ein nie unterschriebener Schein faellt niemandem mehr auf.
    const offeneScheine = (await query(
      `SELECT e.id AS einlagerung_id, e.beleg_nr, e.lagerplatz, e.reifen_groesse, e.status,
              k.id AS kunden_id, k.kunden_nr, k.vorname, k.nachname
         FROM einlagerungen e
         JOIN kunden k ON k.id = e.kunden_id AND k.aktiv = true
        WHERE e.status <> 'Abgeholt'
          AND NOT EXISTS (
            SELECT 1 FROM kunden_dokumente d
             WHERE d.einlagerung_id = e.id
               AND d.typ = 'einlagerungsschein'
               AND d.unterschrift_kunde IS NOT NULL)
        ORDER BY e.erstellt_am DESC`)).rows;
    offeneScheine.forEach(function (r) {
      out.push({
        kunden_id: r.kunden_id, kunden_nr: r.kunden_nr,
        name: [r.vorname, r.nachname].filter(Boolean).join(' '),
        typ: 'einlagerungsschein', dokument: 'Einlagerungsschein', grund: 'noch nicht unterschrieben',
        einlagerung_id: r.einlagerung_id, beleg_nr: r.beleg_nr,
        lagerplatz: r.lagerplatz, reifen_groesse: r.reifen_groesse
      });
    });
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT k.*,
        (SELECT COUNT(*) FROM einlagerungen e
         WHERE e.kunden_id=k.id AND e.status!='Abgeholt') AS aktive_einlagerungen
       FROM kunden k
       WHERE k.id::text=$1 OR k.kunden_nr=$1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    res.json(ohneGeheimnisse(rows[0]));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { vorname, nachname, telefon, telefon2, email, firma, anrede, ust_id,
            strasse, plz, ort, kennzeichen, fahrzeug_marke,
            fahrzeug_modell, baujahr, notizen, ist_gewerbe, grosskunden_rabatt,
            kundentyp, land, rechnung_email, ohne_anschrift } = req.body;
    if (!vorname || !nachname || !telefon)
      return res.status(400).json({ error: 'Vorname, Nachname und Telefon sind Pflicht.' });
    // Firmenkunde: der Firmenname ist der Rechnungsempfaenger, Vor-/Nachname der Ansprechpartner.
    const typP = pruefeKundentyp({ kundentyp, firma });
    if (typP.fehler) return res.status(400).json({ error: typP.fehler });
    // Kein Land angegeben heisst NULL, nicht "Deutschland" — nur so bleibt spaeter erkennbar,
    // ob jemand Deutschland gewaehlt oder das Feld nie ausgefuellt hat. Fuer die PLZ-Pruefung
    // gilt Deutschland als Annahme.
    const landW = land ? String(land).toUpperCase().slice(0, 2) : null;
    // Anschrift ist Pflicht, ABER mit bewusster Ausnahme: wer nur einen Reifen kauft, soll
    // anlegbar bleiben. Die Ausnahme muss ausdruecklich mitgeschickt werden (ohne_anschrift),
    // damit sie eine Entscheidung ist und keine stille Luecke.
    // Weiche Funde (Strasse ohne Hausnummer) einmal zurueckfragen statt sperren — mit
    // hausnummer_bestaetigt kommt derselbe Aufruf durch. Harte Funde bleiben hart.
    const adr = pruefeAnschrift({ strasse, plz, ort, land: landW || 'DE' }, ohne_anschrift !== true);
    if (adr && !(adr.weich && req.body.hausnummer_bestaetigt === true))
      return res.status(400).json({ error: adr.fehler, code: adr.code, rueckfrage: adr.weich === true });
    const reFehler = pruefeRechnungEmail(rechnung_email);
    if (reFehler) return res.status(400).json({ error: reFehler });
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
    const kzP = normKennzeichen(kennzeichen);
    if (!kzP.ok) return res.status(400).json({ error: 'Kennzeichen ungültig (Format z. B. WOR-AB-1234).' });
    const kunden_nr = await nextKundenNr();
    const { rows } = await query(
      `INSERT INTO kunden
         (kunden_nr,vorname,nachname,telefon,telefon2,email,firma,anrede,ust_id,
          strasse,plz,ort,kennzeichen,fahrzeug_marke,fahrzeug_modell,
          baujahr,notizen,ist_gewerbe,grosskunden_rabatt,erstellt_von,
          kundentyp,land,rechnung_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [kunden_nr, vorname.trim(), nachname.trim(), telefon.trim(),
       telefon2||null, email||null, firma||null, anrede||null, ust_id||null,
       strasse||null, plz||null, ort||null,
       kzP.wert,
       fahrzeug_marke||null, fahrzeug_modell||null,
       baujahr||null, notizen||null,
       ist_gewerbe === true, Math.max(0, Math.min(100, parseInt(grosskunden_rabatt) || 0)), req.user.id,
       typP.typ, landW, rechnung_email ? String(rechnung_email).trim() : null]
    );
    await auditLog({ userId: req.user.id, aktion: 'kunden.erstellt',
      tabelle: 'kunden', datensatzId: rows[0].id, neueWerte: ohneGeheimnisse(rows[0]), req });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { rows: old } = await query('SELECT * FROM kunden WHERE id=$1', [req.params.id]);
    if (!old.length) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    const o = old[0];
    let kzWert = o.kennzeichen;
    if (req.body.kennzeichen) {
      const kzP = normKennzeichen(req.body.kennzeichen);
      if (!kzP.ok) return res.status(400).json({ error: 'Kennzeichen ungültig (Format z. B. WOR-AB-1234).' });
      kzWert = kzP.wert;
    }
    // Beim Aendern gelten dieselben Regeln wie beim Anlegen — sonst waere die Pflicht durch
    // "erst ohne Anschrift anlegen, dann irgendetwas eintragen" umgehbar.
    const nTyp = req.body.kundentyp !== undefined ? req.body.kundentyp : o.kundentyp;
    const nFirma = req.body.firma !== undefined ? req.body.firma : o.firma;
    const typP = pruefeKundentyp({ kundentyp: nTyp, firma: nFirma });
    if (typP.fehler) return res.status(400).json({ error: typP.fehler });
    const nLandRoh = req.body.land !== undefined ? req.body.land : o.land;
    const nLand = nLandRoh ? String(nLandRoh).toUpperCase().slice(0, 2) : null;
    const nStr = req.body.strasse !== undefined ? req.body.strasse : o.strasse;
    const nPlz = req.body.plz !== undefined ? req.body.plz : o.plz;
    const nOrt = req.body.ort !== undefined ? req.body.ort : o.ort;
    // Pflicht nur, wenn schon eine Anschrift da war oder gerade eine gesetzt wird: ein
    // Bestandskunde ohne Anschrift laesst sich sonst nicht mehr speichern.
    // Pflicht nur, wenn schon eine Anschrift da war — ein Bestandskunde ohne Anschrift laesst sich
    // sonst nicht mehr speichern. Mit ohne_anschrift laesst sie sich bewusst auch wieder entfernen
    // (etwa wenn sie beim falschen Kunden gelandet war), genauso wie beim Anlegen.
    const hatteAdresse = !!(o.strasse || o.plz || o.ort) && req.body.ohne_anschrift !== true;
    const adr = pruefeAnschrift({ strasse: nStr, plz: nPlz, ort: nOrt, land: nLand || 'DE' }, hatteAdresse);
    if (adr && !(adr.weich && req.body.hausnummer_bestaetigt === true))
      return res.status(400).json({ error: adr.fehler, code: adr.code, rueckfrage: adr.weich === true });
    const nReMail = req.body.rechnung_email !== undefined ? req.body.rechnung_email : o.rechnung_email;
    const reFehler = pruefeRechnungEmail(nReMail);
    if (reFehler) return res.status(400).json({ error: reFehler });
    const { rows } = await query(
      `UPDATE kunden SET
         vorname=$1, nachname=$2, telefon=$3, telefon2=$4,
         email=$5, firma=$6, strasse=$7, plz=$8, ort=$9,
         kennzeichen=$10, fahrzeug_marke=$11, fahrzeug_modell=$12,
         baujahr=$13, notizen=$14, aktiv=$15, ist_gewerbe=$16, grosskunden_rabatt=$17,
         anrede=$18, ust_id=$19, kundentyp=$21, land=$22, rechnung_email=$23
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
       kzWert,
       req.body.fahrzeug_marke  !== undefined ? req.body.fahrzeug_marke  : o.fahrzeug_marke,
       req.body.fahrzeug_modell !== undefined ? req.body.fahrzeug_modell : o.fahrzeug_modell,
       req.body.baujahr       !== undefined ? req.body.baujahr       : o.baujahr,
       req.body.notizen       !== undefined ? req.body.notizen       : o.notizen,
       req.body.aktiv         !== undefined ? req.body.aktiv         : o.aktiv,
       req.body.ist_gewerbe   !== undefined ? (req.body.ist_gewerbe === true) : o.ist_gewerbe,
       req.body.grosskunden_rabatt !== undefined ? Math.max(0, Math.min(100, parseInt(req.body.grosskunden_rabatt) || 0)) : o.grosskunden_rabatt,
       req.body.anrede !== undefined ? req.body.anrede : o.anrede,
       req.body.ust_id !== undefined ? req.body.ust_id : o.ust_id,
       req.params.id,
       typP.typ, nLand, nReMail ? String(nReMail).trim() : null]
    );
    // Auch das Aenderungsprotokoll bekommt keine Geheimnisse: es wird aufbewahrt und
    // ueberlebt eine Kontoloeschung — ein dort abgelegter Hash oder Token waere ein Nachschluessel.
    await auditLog({ userId: req.user.id, aktion: 'kunden.geaendert',
      tabelle: 'kunden', datensatzId: req.params.id,
      alteWerte: ohneGeheimnisse(o), neueWerte: ohneGeheimnisse(rows[0]), req });
    res.json(ohneGeheimnisse(rows[0]));
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
    const kzF = normKennzeichen(kennzeichen);
    if (!kzF.ok) return res.status(400).json({ error: 'Kennzeichen ungültig (Format z. B. WOR-AB-1234).' });
    const t = FAHRZEUG_TYPEN.includes(typ) ? typ : 'PKW';
    const { rows } = await query(
      `INSERT INTO fahrzeuge (kunden_id, typ, marke, modell, kennzeichen, baujahr, hu_datum, notiz)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, t, marke || null, modell || null, kzF.wert, baujahr ? parseInt(baujahr) : null, hu_datum || null, notiz || null]
    );
    await syncPrimaerFahrzeug(req.params.id, rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id/fahrzeuge/:fid', async (req, res, next) => {
  try {
    const { typ, marke, modell, kennzeichen, baujahr, hu_datum, notiz } = req.body;
    if (!marke || !modell || !kennzeichen) return res.status(400).json({ error: 'Kennzeichen, Marke und Modell sind Pflicht.' });
    const kzF = normKennzeichen(kennzeichen);
    if (!kzF.ok) return res.status(400).json({ error: 'Kennzeichen ungültig (Format z. B. WOR-AB-1234).' });
    const t = FAHRZEUG_TYPEN.includes(typ) ? typ : 'PKW';
    const { rows } = await query(
      `UPDATE fahrzeuge SET typ=$1, marke=$2, modell=$3, kennzeichen=$4, baujahr=$5, hu_datum=$6, notiz=$7, geaendert_am=NOW()
       WHERE id=$8 AND kunden_id=$9 RETURNING *`,
      [t, marke || null, modell || null, kzF.wert, baujahr ? parseInt(baujahr) : null, hu_datum || null, notiz || null, req.params.fid, req.params.id]
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
    // Stammkennzeichen des Kunden nachziehen (kein Phantom-Kennzeichen): juengstes verbleibendes Fahrzeug, sonst leeren.
    const rest = (await query('SELECT * FROM fahrzeuge WHERE kunden_id=$1 ORDER BY erstellt_am DESC LIMIT 1', [req.params.id])).rows[0];
    if (rest) await syncPrimaerFahrzeug(req.params.id, rest);
    else await query('UPDATE kunden SET kennzeichen=NULL, fahrzeug_marke=NULL, fahrzeug_modell=NULL WHERE id=$1', [req.params.id]);
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
