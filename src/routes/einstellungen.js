const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { regenerate } = require('../lib/homepage-generate');

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
  'facebook_url', 'instagram_url', 'geo_breite', 'geo_laenge'
];

// Spalten vom Typ time/integer/numeric: leerer String wird zu NULL,
// damit die DB keinen Typfehler wirft, wenn das Frontend '' sendet.
const NULL_IF_EMPTY = new Set([
  'mo_fr_von', 'mo_fr_bis', 'sa_von', 'sa_bis', 'so_von', 'so_bis',
  'mittagspause_von', 'mittagspause_bis',
  'einlagerung_preis_komplett', 'einlagerung_preis_ohne_felgen', 'kofferraum_preis',
  'reifenwechsel_preis', 'mahngebuehr', 'vertragsdauer_monate', 'abholungsfrist_wochen',
  'saison_erinnerung_wochen', 'max_parallele_termine', 'termine_pro_stunde',
  'stornierung_frist_h', 'zahlungsziel_tage'
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
  if (v === '' && NULL_IF_EMPTY.has(col)) return null;
  return v;
}

router.get('/', authenticate, async (req, res, next) => {
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

module.exports = router;
