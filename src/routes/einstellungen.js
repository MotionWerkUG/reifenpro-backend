const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate, requireAdmin, requireStaff } = require('../middleware/auth');
const { regenerate } = require('../lib/homepage-generate');
const feiertage = require('../lib/feiertage');

// Editierbare Spalten (Whitelist). id und geaendert_am werden nie direkt gesetzt.
// Spaltennamen stammen ausschliesslich aus dieser festen Liste -> keine SQL-Injection.
const ALLOWED = [
  'firmenname', 'inhaber', 'strasse', 'plz', 'ort', 'telefon', 'email', 'website',
  'steuernummer', 'ust_id', 'rechtsform', 'handelsreg_nr', 'registergericht',
  'datenschutz_beauftragter', 'logo_url', 'google_bewertung_url', 'impressum',
  'versicherung_name', 'einlagerung_preis_komplett', 'einlagerung_preis_ohne_felgen',
  'kofferraum_preis', 'reifenwechsel_preis', 'mahngebuehr', 'zusatzleistungen', 'agb_zusatz',
  'vertragsdauer_monate', 'verlaengerung_automatisch', 'abholungsfrist_wochen', 'lagerungsort',
  'email_einlagerung', 'email_abholbereit', 'email_bewertung', 'email_raeder_nachziehen',
  'email_erinnerung', 'email_termin_bestaetigung', 'email_termin_erinnerung',
  'email_termin_stornierung', 'email_neukunde_admin', 'saison_erinnerung_wochen',
  'mo_fr_von', 'mo_fr_bis', 'sa_von', 'sa_bis', 'sa_offen',
  'so_offen', 'so_von', 'so_bis', 'mittagspause_von', 'mittagspause_bis',
  'max_parallele_termine', 'termine_pro_stunde', 'stornierung_frist_h', 'portal_url',
  'bank', 'iban', 'bic', 'zahlungsziel_tage',
  'facebook_url', 'instagram_url', 'geo_breite', 'geo_laenge', 'bundesland', 'buchbar_ab'
];

// Spalten vom Typ time/integer/numeric: leerer String wird zu NULL,
// damit die DB keinen Typfehler wirft, wenn das Frontend '' sendet.
const NULL_IF_EMPTY = new Set([
  'mo_fr_von', 'mo_fr_bis', 'sa_von', 'sa_bis', 'so_von', 'so_bis',
  'mittagspause_von', 'mittagspause_bis',
  'einlagerung_preis_komplett', 'einlagerung_preis_ohne_felgen', 'kofferraum_preis',
  'reifenwechsel_preis', 'mahngebuehr', 'vertragsdauer_monate', 'abholungsfrist_wochen',
  'saison_erinnerung_wochen', 'max_parallele_termine', 'termine_pro_stunde',
  'stornierung_frist_h', 'zahlungsziel_tage', 'buchbar_ab'
]);

const DEFAULT = {
  firmenname: '', inhaber: '', strasse: '', plz: '', ort: '', telefon: '',
  email: '', website: '', steuernummer: '', ust_id: '', rechtsform: 'Einzelunternehmen',
  handelsreg_nr: '', registergericht: '', datenschutz_beauftragter: '',
  logo_url: null, google_bewertung_url: '', impressum: '', versicherung_name: '',
  einlagerung_preis_komplett: 49, einlagerung_preis_ohne_felgen: 39,
  kofferraum_preis: 0, reifenwechsel_preis: 29, mahngebuehr: 15,
  zusatzleistungen: '', agb_zusatz: '',
  vertragsdauer_monate: 6, verlaengerung_automatisch: true,
  abholungsfrist_wochen: 4, lagerungsort: 'in unserem Betrieb',
  email_einlagerung: '', email_abholbereit: '',
  email_raeder_nachziehen: 'Bitte denken Sie daran, die Radschrauben nach ca. 50-100 km nachzuziehen.',
  email_bewertung: '', email_erinnerung: '',
  mo_fr_von: '08:00', mo_fr_bis: '18:00',
  sa_von: '08:00', sa_bis: '13:00', sa_offen: true, termine_pro_stunde: 2,
  bank: '', iban: '', bic: '', zahlungsziel_tage: 14
};

function normalize(col, v) {
  // Defense-in-Depth: Winkelklammern aus allen Freitext-Firmendaten entfernen (werden u.a. im
  // Kundenportal/Homepage gerendert). Zahlen-/Zeit-/Bool-Felder sind davon nicht betroffen.
  if (typeof v === 'string') v = v.replace(/[<>]/g, '');
  if (v === '' && NULL_IF_EMPTY.has(col)) return null;
  return v;
}

router.get('/', authenticate, requireStaff, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM einstellungen ORDER BY id LIMIT 1');
    res.json(rows.length ? rows[0] : DEFAULT);
  } catch (err) { next(err); }
});

router.put('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const e = req.body || {};
    // Nur erlaubte, tatsaechlich gesendete Felder uebernehmen (partielles Update moeglich).
    const cols = ALLOWED.filter(c => Object.prototype.hasOwnProperty.call(e, c));

    const existing = await query('SELECT id FROM einstellungen ORDER BY id LIMIT 1');

    if (existing.rows.length) {
      const id = existing.rows[0].id;
      if (!cols.length) {
        const cur = await query('SELECT * FROM einstellungen WHERE id=$1', [id]);
        return res.json(cur.rows[0]);
      }
      const params = cols.map(c => normalize(c, e[c]));
      const sets = cols.map((c, i) => c + '=$' + (i + 1));
      params.push(id);
      const { rows } = await query(
        'UPDATE einstellungen SET ' + sets.join(', ') + ', geaendert_am=NOW() WHERE id=$' + params.length + ' RETURNING *',
        params
      );
      regenerate().catch(function () {});
      return res.json(rows[0]);
    }

    // Noch keine Zeile vorhanden -> erstmalig anlegen.
    const insertCols = cols.length ? cols : ['firmenname'];
    const params = insertCols.map(c => normalize(c, e[c]));
    const ph = insertCols.map((_, i) => '$' + (i + 1));
    const { rows } = await query(
      'INSERT INTO einstellungen (' + insertCols.join(', ') + ') VALUES (' + ph.join(', ') + ') RETURNING *',
      params
    );
    regenerate().catch(function () {});
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── Öffnungszeiten (neues Modell: je Wochentag, 2 Spannen) ──
router.get('/oeffnungszeiten', authenticate, async (req, res, next) => {
  try {
    const woche = (await query('SELECT wochentag, geschlossen, von1, bis1, von2, bis2 FROM oeffnungszeiten ORDER BY wochentag')).rows;
    const e = (await query('SELECT bundesland FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
    res.json({ woche, bundesland: e.bundesland || 'BY' });
  } catch (err) { next(err); }
});

router.put('/oeffnungszeiten', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const woche = Array.isArray(req.body.woche) ? req.body.woche : [];
    const t = (v) => (v === '' || v == null) ? null : v;
    for (const d of woche) {
      const wt = parseInt(d.wochentag, 10);
      if (!(wt >= 0 && wt <= 6)) continue;
      await query(
        `INSERT INTO oeffnungszeiten (wochentag, geschlossen, von1, bis1, von2, bis2)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (wochentag) DO UPDATE SET geschlossen=$2, von1=$3, bis1=$4, von2=$5, bis2=$6`,
        [wt, !!d.geschlossen, t(d.von1), t(d.bis1), t(d.von2), t(d.bis2)]
      );
    }
    // Alt-Felder (mo_fr/sa/so/mittagspause) fuer die Homepage-Anzeige aus dem Wochenraster synchron
    // halten -> der Homepage-Renderer (anderer Bereich) bleibt unveraendert und zeigt weiter die
    // regulaeren Zeiten. Besondere Tage/Feiertage wirken separat ueber die Buchungslogik.
    if (woche.length) {
      const byWt = {}; woche.forEach((d) => { byWt[parseInt(d.wochentag, 10)] = d; });
      const mo = byWt[0], sa = byWt[5], so = byWt[6];
      const pause = (d) => d && !d.geschlossen && d.von2 && d.bis2;
      const sync = {
        mo_fr_von: mo && !mo.geschlossen ? t(mo.von1) : null,
        mo_fr_bis: mo && !mo.geschlossen ? t(pause(mo) ? mo.bis2 : mo.bis1) : null,
        mittagspause_von: pause(mo) ? t(mo.bis1) : null,
        mittagspause_bis: pause(mo) ? t(mo.von2) : null,
        sa_offen: sa ? !sa.geschlossen : false,
        sa_von: sa && !sa.geschlossen ? t(sa.von1) : null,
        sa_bis: sa && !sa.geschlossen ? t(sa.bis1) : null,
        so_offen: so ? !so.geschlossen : false,
        so_von: so && !so.geschlossen ? t(so.von1) : null,
        so_bis: so && !so.geschlossen ? t(so.bis1) : null
      };
      const scols = Object.keys(sync);
      await query(
        'UPDATE einstellungen SET ' + scols.map((c, i) => c + '=$' + (i + 1)).join(', ') + ', geaendert_am=NOW() WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1)',
        scols.map((c) => sync[c])
      );
    }
    if (req.body.bundesland) {
      await query('UPDATE einstellungen SET bundesland=$1, geaendert_am=NOW() WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1)', [req.body.bundesland]);
    }
    regenerate().catch(function () {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Besondere Tage (Feiertage, Betriebsurlaub) — ueberschreiben die regulaere Woche ──
router.get('/besondere-tage', authenticate, async (req, res, next) => {
  try {
    const jahr = parseInt(req.query.jahr, 10);
    let sql = "SELECT id, to_char(datum,'YYYY-MM-DD') AS datum, bezeichnung, geschlossen, to_char(von,'HH24:MI') AS von, to_char(bis,'HH24:MI') AS bis, quelle FROM besondere_tage";
    const params = [];
    if (jahr) { params.push(jahr); sql += ' WHERE extract(year from datum)=$1'; }
    sql += ' ORDER BY datum';
    res.json((await query(sql, params)).rows);
  } catch (err) { next(err); }
});

router.post('/besondere-tage', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { datum, bezeichnung, geschlossen, von, bis, quelle } = req.body || {};
    if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ error: 'Gültiges Datum (YYYY-MM-DD) erforderlich.' });
    const t = (v) => (v === '' || v == null) ? null : v;
    const { rows } = await query(
      `INSERT INTO besondere_tage (datum, bezeichnung, geschlossen, von, bis, quelle)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (datum) DO UPDATE SET bezeichnung=$2, geschlossen=$3, von=$4, bis=$5, quelle=$6
       RETURNING id, to_char(datum,'YYYY-MM-DD') AS datum, bezeichnung, geschlossen, to_char(von,'HH24:MI') AS von, to_char(bis,'HH24:MI') AS bis, quelle`,
      [datum, t(bezeichnung), geschlossen == null ? true : !!geschlossen, t(von), t(bis), quelle === 'feiertag' ? 'feiertag' : 'manuell']
    );
    regenerate().catch(function () {});
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/besondere-tage/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await query('DELETE FROM besondere_tage WHERE id=$1', [req.params.id]);
    regenerate().catch(function () {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Feiertage automatisch fuer Bundesland + Jahr anlegen (bestehende Tage bleiben unangetastet) ──
router.post('/feiertage-generieren', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const jahr = parseInt(req.query.jahr || (req.body && req.body.jahr), 10) || new Date().getFullYear();
    const e = (await query('SELECT bundesland FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
    const bl = (req.body && req.body.bundesland) || e.bundesland || 'BY';
    const liste = feiertage.feiertage(bl, jahr);
    let angelegt = 0;
    for (const f of liste) {
      const r = await query(
        `INSERT INTO besondere_tage (datum, bezeichnung, geschlossen, quelle)
         VALUES ($1,$2,true,'feiertag') ON CONFLICT (datum) DO NOTHING`,
        [f.datum, f.name]
      );
      if (r.rowCount) angelegt++;
    }
    regenerate().catch(function () {});
    res.json({ jahr, bundesland: bl, gefunden: liste.length, angelegt });
  } catch (err) { next(err); }
});

module.exports = router;
