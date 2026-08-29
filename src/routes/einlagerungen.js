const router = require('express').Router();
const { query, withTransaction } = require('../db/index');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const { sendMail } = require('../lib/mailer');
const { kundenMailHtml } = require('../lib/mail-template');
const { normalisiereLagerplatz, kapazitaetFuer } = require('../lib/lagerplatz');

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
    // Reifentyp gegen dieselbe Whitelist wie die DB-CHECK-Constraint pruefen; sonst schlaegt erst
    // die Constraint zu und der Nutzer bekommt HTTP 500 statt einer verstaendlichen 400-Meldung.
    if (!['Winter','Sommer','Ganzjahr'].includes(reifen_typ))
      return res.status(400).json({ error: 'Reifentyp muss Winter, Sommer oder Ganzjahr sein.' });
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
    // Lagerplatz auf die Schreibweise des Lagerplans bringen ("A-01-7" -> "A-01-07").
    // Ohne das umgehen abweichende Schreibweisen die Doppelbelegungssperre, und der Platz
    // taucht im Lagerplan als "nicht zugeordnet" auf, obwohl er real belegt ist.
    const lp = normalisiereLagerplatz(lagerplatz);
    if (!lp) return res.status(400).json({ error: 'Lagerplatz erforderlich.' });
    // Pruefung + Insert in einer Transaktion mit Advisory-Lock je Lagerplatz
    // -> verhindert, dass zwei gleichzeitige Einlagerungen denselben Platz belegen.
    const neu = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['lagerplatz:' + lp]);
      // Ein Platz fasst so viele Saetze, wie das Regal erlaubt (gestapelter Container: 2).
      // Beide Saetze tragen denselben Platz; wer welcher ist, steht ueber Kundennummer und
      // Kennzeichen auf dem Etikett.
      const kap = await kapazitaetFuer(client, lp);
      const belegt = await client.query(
        `SELECT e.id, k.kunden_nr, k.nachname FROM einlagerungen e
           LEFT JOIN kunden k ON k.id = e.kunden_id
          WHERE e.lagerplatz=$1 AND e.status!='Abgeholt'`, [lp]);
      if (belegt.rows.length >= kap) {
        const wer = belegt.rows.map(function (r) { return [r.kunden_nr, r.nachname].filter(Boolean).join(' '); }).filter(Boolean).join(', ');
        const e = new Error(kap > 1
          ? `Lagerplatz ${lp} ist voll (${belegt.rows.length} von ${kap} Sätzen)${wer ? ': ' + wer : ''}.`
          : `Lagerplatz ${lp} ist bereits belegt${wer ? ' durch ' + wer : ''}.`);
        e.status = 409; throw e;
      }
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
      // Erster Eintrag der Platz-Historie: ab hier ist nachvollziehbar, wo der Satz wann lag.
      await client.query(
        `INSERT INTO einlagerung_platz_historie (einlagerung_id, lagerplatz, von, grund, geaendert_von)
         VALUES ($1, $2, NOW(), 'eingelagert', $3)`,
        [ins.rows[0].id, lp, req.user.id]);
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
    const lp = normalisiereLagerplatz(lagerplatz);
    if (!lp) return res.status(400).json({ error: 'Lagerplatz erforderlich.' });
    const updated = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['lagerplatz:' + lp]);
      const kap = await kapazitaetFuer(client, lp);
      const belegt = await client.query(
        `SELECT e.id, k.kunden_nr, k.nachname FROM einlagerungen e
           LEFT JOIN kunden k ON k.id = e.kunden_id
          WHERE e.lagerplatz=$1 AND e.status!='Abgeholt' AND e.id<>$2`, [lp, req.params.id]);
      if (belegt.rows.length >= kap) {
        const wer = belegt.rows.map(function (r) { return [r.kunden_nr, r.nachname].filter(Boolean).join(' '); }).filter(Boolean).join(', ');
        const e = new Error(kap > 1
          ? `Lagerplatz ${lp} ist voll (${belegt.rows.length} von ${kap} Sätzen)${wer ? ': ' + wer : ''}.`
          : `Lagerplatz ${lp} ist bereits belegt${wer ? ' durch ' + wer : ''}.`);
        e.status = 409; throw e;
      }
      const vorher = (await client.query('SELECT lagerplatz FROM einlagerungen WHERE id=$1', [req.params.id])).rows[0];
      if (!vorher) return null;
      const r = await client.query(
        'UPDATE einlagerungen SET lagerplatz=$1, geaendert_von=$2 WHERE id=$3 RETURNING *',
        [lp, req.user.id, req.params.id]);
      // Historie: der Kunde kommt mit einem Beleg, auf dem der ALTE Platz steht. Ohne diese Spur
      // findet der Tresen den Satz nicht wieder. Alter Eintrag wird abgeschlossen, neuer geoeffnet.
      await client.query(
        `UPDATE einlagerung_platz_historie SET bis = NOW()
         WHERE einlagerung_id = $1 AND bis IS NULL`, [req.params.id]);
      await client.query(
        `INSERT INTO einlagerung_platz_historie (einlagerung_id, lagerplatz, von, grund, geaendert_von)
         VALUES ($1, $2, NOW(), $3, $4)`,
        [req.params.id, lp, (req.body && req.body.grund) || 'umgelagert', req.user.id]);
      return Object.assign({}, r.rows[0], { _vorher: vorher.lagerplatz });
    });
    if (!updated) return res.status(404).json({ error: 'Nicht gefunden.' });
    await auditLog({ userId: req.user.id, aktion: 'einlagerung.lagerplatz_geaendert',
      tabelle: 'einlagerungen', datensatzId: req.params.id,
      alteWerte: { lagerplatz: updated._vorher }, neueWerte: { lagerplatz: lp }, req });
    delete updated._vorher;
    res.json(updated);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Loeschung einer abgeholten Einlagerung. Bewusst restriktiv und transaktional:
// an einer Einlagerung haengen Belege (Protokolle, unterschriebene Dokumente) und die
// Wiedereinlagerungs-Kette. Ohne Pruefung liefe das DELETE in eine FK-Verletzung
// (protokolle.einlagerung_id ist NO ACTION -> 500 "Interner Serverfehler") oder wuerde
// still Verknuepfungen kappen (ON DELETE SET NULL bei kunden_dokumente/vorgaenger_id).
// Darum: klare 409-Meldung mit Grund statt Datenverlust oder unverstaendlichem Fehler.
// requireAdmin wie bei den anderen Loeschrouten (artikel.js, users.js, lager.js): hier werden
// endgueltig Geschaeftsbelege entfernt, das ist keine Mitarbeiter-Alltagsaktion.
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || '');
    // Ungueltige UUID wuerde in Postgres als 22P02 knallen (500) -> als "nicht gefunden" behandeln.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return res.status(404).json({ error: 'Nicht gefunden.' });

    const out = await withTransaction(async (client) => {
      const e = (await client.query(
        'SELECT id, beleg_nr, status FROM einlagerungen WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!e) return { code: 404, body: { error: 'Nicht gefunden.' } };
      if (e.status !== 'Abgeholt')
        return { code: 400, body: { error: 'Nur abgeholte Einlagerungen können gelöscht werden.' } };

      // 1. Protokolle = unterschriebene Belege (Aufbewahrungspflicht) und harter FK-Blocker.
      const prot = (await client.query(
        'SELECT COUNT(*)::int AS c FROM protokolle WHERE einlagerung_id=$1', [id])).rows[0].c;
      if (prot)
        return { code: 409, body: { error: 'Nicht löschbar: ' + prot + ' Protokoll(e) gehören zu dieser Einlagerung (Aufbewahrungspflicht). Erst das Protokoll löschen.' } };

      // 2. Unterschriebene Dokumente (Einlagerungsvertrag/-schein) sind ebenfalls Belege.
      const dokUnt = (await client.query(
        'SELECT COUNT(*)::int AS c FROM kunden_dokumente WHERE einlagerung_id=$1 AND unterschrift_kunde IS NOT NULL', [id])).rows[0].c;
      if (dokUnt)
        return { code: 409, body: { error: 'Nicht löschbar: ' + dokUnt + ' unterschriebene(s) Dokument(e) gehören zu dieser Einlagerung (Aufbewahrungspflicht).' } };

      // 3. Folge-Einlagerung: Loeschen wuerde die Wiedereinlagerungs-Kette still zerreissen
      //    (vorgaenger_id -> NULL), die Historie waere danach unvollstaendig.
      const nachf = (await client.query(
        'SELECT COUNT(*)::int AS c FROM einlagerungen WHERE vorgaenger_id=$1', [id])).rows[0].c;
      if (nachf)
        return { code: 409, body: { error: 'Nicht löschbar: ' + nachf + ' spätere Einlagerung(en) bauen als Wiedereinlagerung darauf auf.' } };

      // Nur noch unverknuepfte Reste: Dokumente ohne Unterschrift explizit entkoppeln
      // (statt sich auf ON DELETE SET NULL zu verlassen) und Anzahl protokollieren.
      const dokLos = (await client.query(
        'UPDATE kunden_dokumente SET einlagerung_id=NULL WHERE einlagerung_id=$1 RETURNING id', [id])).rowCount;
      await client.query('DELETE FROM einlagerungen WHERE id=$1', [id]);
      return { code: 200, body: { message: 'Gelöscht.' }, beleg_nr: e.beleg_nr, dokEntkoppelt: dokLos };
    });

    if (out.code !== 200) return res.status(out.code).json(out.body);
    await auditLog({ userId: req.user.id, aktion: 'einlagerung.geloescht',
      tabelle: 'einlagerungen', datensatzId: id,
      alteWerte: { beleg_nr: out.beleg_nr, dokumente_entkoppelt: out.dokEntkoppelt }, req });
    res.json(out.body);
  } catch (err) { next(err); }
});

module.exports = router;
