'use strict';
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { query } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { regenerate } = require('../lib/homepage-generate');
const { verarbeite } = require('../lib/bildverarbeitung');

const UPLOAD_DIR = '/var/www/schroeder-homepage/uploads';
const FONT_DIR = '/var/www/schroeder-homepage/uploads/fonts';
const TYPEN = ['hero', 'leistung', 'text', 'oeffnungszeiten', 'kontakt', 'faq', 'kundenstimmen', 'galerie'];
const NEU_HEADLINE = { leistung: 'Neue Leistung', faq: 'Häufige Fragen', kundenstimmen: 'Das sagen unsere Kunden', galerie: 'Galerie' };
// Strukturierte Bausteindaten je Typ pruefen/begrenzen (verhindert Wildwuchs + XSS-Vektoren)
function txt(v, n) { return String(v == null ? '' : v).slice(0, n); }
function bereinigeDaten(typ, d) {
  d = d && typeof d === 'object' ? d : {};
  if (typ === 'faq') {
    return { items: (Array.isArray(d.items) ? d.items : []).slice(0, 40)
      .map(function (i) { return { frage: txt(i && i.frage, 200), antwort: txt(i && i.antwort, 2000) }; })
      .filter(function (i) { return i.frage.trim(); }) };
  }
  if (typ === 'kundenstimmen') {
    return {
      google_url: /^https?:\/\//.test((d.google_url || '')) ? txt(d.google_url, 300) : '',
      items: (Array.isArray(d.items) ? d.items : []).slice(0, 40)
        .map(function (i) { return { text: txt(i && i.text, 600), name: txt(i && i.name, 80), sterne: Math.max(0, Math.min(5, parseInt(i && i.sterne) || 0)) }; })
        .filter(function (i) { return i.text.trim(); })
    };
  }
  if (typ === 'galerie') {
    return { bilder: (Array.isArray(d.bilder) ? d.bilder : []).slice(0, 60)
      .filter(function (u) { return /^\/uploads\/[\w.\-\/]+$/.test(u || ''); }) };
  }
  return null;
}

router.use(authenticate, requireStaff);

router.get('/sektionen', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM homepage_sektionen ORDER BY sortierung');
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/sektionen', async (req, res, next) => {
  try {
    const typ = TYPEN.includes(req.body.typ) ? req.body.typ : 'text';
    const max = (await query('SELECT COALESCE(MAX(sortierung),0)+10 AS s FROM homepage_sektionen')).rows[0].s;
    const leer = ['faq', 'kundenstimmen', 'galerie'].indexOf(typ) !== -1;
    const { rows } = await query(
      'INSERT INTO homepage_sektionen (typ, sortierung, headline, inhalt) VALUES ($1,$2,$3,$4) RETURNING *',
      [typ, max, NEU_HEADLINE[typ] || 'Neuer Abschnitt', leer ? null : 'Text hier eingeben …']
    );
    await regenerate();
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/sektionen/:id', async (req, res, next) => {
  try {
    const cur = (await query('SELECT * FROM homepage_sektionen WHERE id=$1', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Abschnitt nicht gefunden.' });
    // Vorherigen Stand fuer Undo sichern (letzte 12 behalten)
    const snap = { headline: cur.headline, subline: cur.subline, inhalt: cur.inhalt, bild_url: cur.bild_url, bild_alt: cur.bild_alt, cta_text: cur.cta_text, cta_url: cur.cta_url, sichtbar: cur.sichtbar, daten: cur.daten };
    await query('INSERT INTO sektion_historie (sektion_id, daten, beschreibung) VALUES ($1,$2,$3)', [cur.id, JSON.stringify(snap), (cur.headline || cur.typ || 'Abschnitt')]);
    await query('DELETE FROM sektion_historie WHERE id NOT IN (SELECT id FROM sektion_historie ORDER BY id DESC LIMIT 12)');
    const { headline, subline, inhalt, bild_url, bild_alt, cta_text, cta_url, sichtbar } = req.body;
    const bAid = req.body.buchung_artikel_id !== undefined ? (req.body.buchung_artikel_id || null) : cur.buchung_artikel_id;
    const daten = req.body.daten !== undefined ? bereinigeDaten(cur.typ, req.body.daten) : cur.daten;
    const { rows } = await query(
      `UPDATE homepage_sektionen SET headline=$1, subline=$2, inhalt=$3, bild_url=$4, cta_text=$5, cta_url=$6, sichtbar=$7, buchung_artikel_id=$8, bild_alt=$9, daten=$10, geaendert_am=NOW()
       WHERE id=$11 RETURNING *`,
      [headline || null, subline || null, inhalt || null, bild_url || null, cta_text || null, cta_url || null, sichtbar !== false, bAid,
       bild_alt !== undefined ? (bild_alt || null) : cur.bild_alt, daten ? JSON.stringify(daten) : null, req.params.id]
    );
    await regenerate();
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Letzte Aenderungen (fuer Undo-Anzeige)
router.get('/sektionen-historie', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, sektion_id, beschreibung, geaendert_am FROM sektion_historie ORDER BY id DESC LIMIT 5');
    res.json(rows);
  } catch (e) { next(e); }
});

// Letzte Aenderung rueckgaengig machen
router.post('/sektionen-undo', async (req, res, next) => {
  try {
    const h = (await query('SELECT * FROM sektion_historie ORDER BY id DESC LIMIT 1')).rows[0];
    if (!h) return res.status(400).json({ error: 'Keine Änderung zum Rückgängigmachen vorhanden.' });
    const d = h.daten || {};
    await query(
      `UPDATE homepage_sektionen SET headline=$1, subline=$2, inhalt=$3, bild_url=$4, cta_text=$5, cta_url=$6, sichtbar=$7, bild_alt=$8, daten=$9, geaendert_am=NOW() WHERE id=$10`,
      [d.headline || null, d.subline || null, d.inhalt || null, d.bild_url || null, d.cta_text || null, d.cta_url || null, d.sichtbar !== false,
       d.bild_alt || null, d.daten ? JSON.stringify(d.daten) : null, h.sektion_id]
    );
    await query('DELETE FROM sektion_historie WHERE id=$1', [h.id]);
    await regenerate();
    res.json({ message: 'Rückgängig gemacht.', beschreibung: h.beschreibung });
  } catch (e) { next(e); }
});

router.delete('/sektionen/:id', async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM homepage_sektionen WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Abschnitt nicht gefunden.' });
    await regenerate();
    res.json({ message: 'Gelöscht.' });
  } catch (e) { next(e); }
});

router.post('/sektionen/:id/move', async (req, res, next) => {
  try {
    const up = req.body.dir === 'up';
    const cur = (await query('SELECT * FROM homepage_sektionen WHERE id=$1', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Abschnitt nicht gefunden.' });
    const nb = (await query(
      'SELECT * FROM homepage_sektionen WHERE sortierung ' + (up ? '<' : '>') + ' $1 ORDER BY sortierung ' + (up ? 'DESC' : 'ASC') + ' LIMIT 1',
      [cur.sortierung]
    )).rows[0];
    if (nb) {
      await query('UPDATE homepage_sektionen SET sortierung=$1 WHERE id=$2', [nb.sortierung, cur.id]);
      await query('UPDATE homepage_sektionen SET sortierung=$1 WHERE id=$2', [cur.sortierung, nb.id]);
      await regenerate();
    }
    res.json({ message: 'ok' });
  } catch (e) { next(e); }
});

router.post('/bild', async (req, res, next) => {
  try {
    const { data, format } = req.body;
    const m = /^data:(image\/(png|jpe?g|webp|gif|heic|heif));base64,(.+)$/.exec(data || '');
    if (!m) return res.status(400).json({ error: 'Ungültiges Bildformat (JPG/PNG/WEBP/HEIC).' });
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    // Jedes Bild wird passend zugeschnitten und komprimiert -> JPG.
    const out = await verarbeite(Buffer.from(m[3], 'base64'), format === 'hero' ? 'hero' : 'inhalt');
    const name = 'img-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.jpg';
    fs.writeFileSync(path.join(UPLOAD_DIR, name), out);
    res.json({ url: '/uploads/' + name });
  } catch (e) { next(e); }
});

router.post('/render', async (req, res, next) => {
  try { await regenerate(); res.json({ message: 'Homepage neu erzeugt.' }); } catch (e) { next(e); }
});

// Aktionsbanner laden
router.get('/banner', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT aktion_aktiv, aktion_text, aktion_code, aktion_position, aktion_link FROM einstellungen ORDER BY id LIMIT 1');
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});

// Aktionsbanner speichern + Homepage neu erzeugen
router.put('/banner', async (req, res, next) => {
  try {
    const { aktion_aktiv, aktion_text, aktion_code, aktion_position, aktion_link } = req.body;
    const pos = ['leiste', 'ecke-links', 'ecke-rechts'].includes(aktion_position) ? aktion_position : 'leiste';
    const upd = await query(
      `UPDATE einstellungen SET aktion_aktiv=$1, aktion_text=$2, aktion_code=$3, aktion_position=$4, aktion_link=$5
       WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1) RETURNING aktion_aktiv`,
      [aktion_aktiv === true, aktion_text || null, aktion_code || null, pos, aktion_link || null]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Einstellungen nicht gefunden.' });
    await regenerate();
    res.json({ message: 'Banner gespeichert.' });
  } catch (e) { next(e); }
});

// Navigationsbuttons laden
const DEFAULT_NAV = [
  { label: 'Leistungen', url: '#leistungen', sichtbar: true, btn: false },
  { label: 'Termin buchen', url: '/termin/', sichtbar: true, btn: false },
  { label: 'Öffnungszeiten', url: '#oeffnungszeiten', sichtbar: true, btn: false },
  { label: 'Kontakt', url: '#kontakt', sichtbar: true, btn: false },
  { label: 'Kundenportal', url: '/portal/', sichtbar: true, btn: true }
];
router.get('/nav', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT nav_links FROM einstellungen ORDER BY id LIMIT 1');
    const nav = rows[0] && Array.isArray(rows[0].nav_links) && rows[0].nav_links.length ? rows[0].nav_links : DEFAULT_NAV;
    res.json(nav);
  } catch (e) { next(e); }
});

// Navigationsbuttons speichern + Homepage neu erzeugen
router.put('/nav', async (req, res, next) => {
  try {
    const eingabe = Array.isArray(req.body) ? req.body : (req.body && req.body.nav_links);
    if (!Array.isArray(eingabe)) return res.status(400).json({ error: 'Liste der Navigationspunkte erforderlich.' });
    const nav = eingabe
      .filter((i) => i && typeof i.label === 'string' && i.label.trim())
      .slice(0, 12)
      .map((i) => ({
        label: String(i.label).trim().slice(0, 40),
        url: String(i.url || '#').trim().slice(0, 300),
        sichtbar: i.sichtbar !== false,
        btn: i.btn === true
      }));
    if (!nav.length) return res.status(400).json({ error: 'Mindestens ein Navigationspunkt erforderlich.' });
    const upd = await query(
      `UPDATE einstellungen SET nav_links=$1 WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1) RETURNING id`,
      [JSON.stringify(nav)]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Einstellungen nicht gefunden.' });
    await regenerate();
    res.json({ message: 'Navigation gespeichert.' });
  } catch (e) { next(e); }
});

// Online-Buchungsbereich (Gäste) laden
router.get('/buchung', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT buchung_aktiv, buchung_titel, buchung_text FROM einstellungen ORDER BY id LIMIT 1');
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});

// Online-Buchungsbereich speichern + Homepage neu erzeugen
router.put('/buchung', async (req, res, next) => {
  try {
    const { buchung_aktiv, buchung_titel, buchung_text } = req.body;
    const upd = await query(
      `UPDATE einstellungen SET buchung_aktiv=$1, buchung_titel=$2, buchung_text=$3
       WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1) RETURNING buchung_aktiv`,
      [buchung_aktiv === true, buchung_titel || null, buchung_text || null]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Einstellungen nicht gefunden.' });
    await regenerate();
    res.json({ message: 'Buchungsbereich gespeichert.' });
  } catch (e) { next(e); }
});

// ── Firmendaten: Kontakt & Öffnungszeiten (fuer Redakteure ohne Admin-Zugriff) ──
// Bearbeitet gezielt die oeffentlich sichtbaren Spalten aus `einstellungen`
// (Adresse/Telefon/E-Mail/Geo/Social/Oeffnungszeiten) und laesst alle anderen unberuehrt.
const FIRMA_SELECT = 'firmenname, strasse, plz, ort, telefon, email, geo_breite, geo_laenge, ' +
  'google_bewertung_url, facebook_url, instagram_url, mo_fr_von, mo_fr_bis, sa_offen, sa_von, sa_bis, so_offen, so_von, so_bis';
router.get('/firmendaten', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT ' + FIRMA_SELECT + ' FROM einstellungen ORDER BY id LIMIT 1');
    const data = rows[0] || {};
    // Rechnungsrelevante Stammdaten (Firmenname/Adresse) darf nur der Admin aendern.
    // Flag steuert im CMS, ob diese Felder editierbar oder nur lesbar angezeigt werden.
    data.darf_stammdaten = req.user.rolle === 'admin';
    res.json(data);
  } catch (e) { next(e); }
});
router.put('/firmendaten', async (req, res, next) => {
  try {
    const b = req.body || {};
    const istAdmin = req.user.rolle === 'admin';
    // Freitext: Winkelklammern raus (kein HTML/JS in Firmendaten), trimmen, begrenzen
    const t = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').trim().slice(0, n) || null;
    const url = (v) => (/^https?:\/\//i.test(String(v || '').trim()) ? String(v).trim().slice(0, 300) : null);
    // Uhrzeit nur HH:MM akzeptieren, sonst NULL (Zeile verschwindet dann von der Website)
    const zeit = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '').trim()) ? String(v).trim() : null);
    // Geo-Koordinate als Dezimalzahl (Komma erlaubt), sonst NULL
    const geo = (v) => { let s = String(v || '').trim().replace(',', '.'); return /^-?\d{1,3}(\.\d{1,8})?$/.test(s) ? s : null; };
    // Firmenname + Adresse sind Pflichtangaben fuer den Rechnungskopf (§ 14 UStG) und
    // duerfen NUR vom Admin geaendert werden. Mitarbeiter behalten die bestehenden Werte.
    const cur = (await query('SELECT firmenname, strasse, plz, ort FROM einstellungen ORDER BY id LIMIT 1')).rows[0];
    if (!cur) return res.status(404).json({ error: 'Einstellungen nicht gefunden.' });
    let firmenname = cur.firmenname, strasse = cur.strasse, plz = cur.plz, ort = cur.ort;
    if (istAdmin) {
      firmenname = t(b.firmenname, 120); strasse = t(b.strasse, 120); plz = t(b.plz, 10); ort = t(b.ort, 80);
      // Pflichtfelder duerfen nicht geleert werden (sonst unvollstaendiger Rechnungskopf)
      if (!firmenname || !strasse || !plz || !ort)
        return res.status(400).json({ error: 'Firmenname, Straße, PLZ und Ort dürfen nicht leer sein (Pflichtangaben für Rechnungen).' });
    }
    const saOffen = b.sa_offen === true;
    const soOffen = b.so_offen === true;
    await query(
      `UPDATE einstellungen SET firmenname=$1, strasse=$2, plz=$3, ort=$4, telefon=$5, email=$6,
         geo_breite=$7, geo_laenge=$8, google_bewertung_url=$9, facebook_url=$10, instagram_url=$11,
         mo_fr_von=$12, mo_fr_bis=$13, sa_offen=$14, sa_von=$15, sa_bis=$16, so_offen=$17, so_von=$18, so_bis=$19,
         geaendert_am=NOW()
       WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1)`,
      [firmenname, strasse, plz, ort, t(b.telefon, 40), t(b.email, 160),
       geo(b.geo_breite), geo(b.geo_laenge), url(b.google_bewertung_url), url(b.facebook_url), url(b.instagram_url),
       zeit(b.mo_fr_von), zeit(b.mo_fr_bis),
       saOffen, saOffen ? zeit(b.sa_von) : null, saOffen ? zeit(b.sa_bis) : null,
       soOffen, soOffen ? zeit(b.so_von) : null, soOffen ? zeit(b.so_bis) : null]
    );
    await regenerate();
    res.json({ message: 'Firmendaten gespeichert.' });
  } catch (e) { next(e); }
});

// ── Buchungs-Leistungen (Haupt-/Zusatzleistungen fuer den Buchungsassistenten) ──
router.get('/leistungen', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT bl.*, a.name AS artikel_name, a.dauer_minuten
       FROM buchung_leistungen bl JOIN artikel a ON a.id = bl.artikel_id
       ORDER BY bl.rolle, bl.sortierung, a.name`);
    res.json(rows);
  } catch (e) { next(e); }
});
router.post('/leistungen', async (req, res, next) => {
  try {
    const { artikel_id, rolle, titel, beschreibung, bild_url, sortierung } = req.body;
    if (!artikel_id) return res.status(400).json({ error: 'Leistung (Artikel) ist Pflicht.' });
    const r = ['haupt', 'zusatz'].includes(rolle) ? rolle : 'haupt';
    const max = (await query('SELECT COALESCE(MAX(sortierung),0)+1 AS s FROM buchung_leistungen WHERE rolle=$1', [r])).rows[0].s;
    const { rows } = await query(
      'INSERT INTO buchung_leistungen (artikel_id, rolle, titel, beschreibung, bild_url, sortierung) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [artikel_id, r, titel || null, beschreibung || null, bild_url || null, sortierung != null ? sortierung : max]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});
router.put('/leistungen/:id', async (req, res, next) => {
  try {
    const cur = (await query('SELECT * FROM buchung_leistungen WHERE id=$1', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Nicht gefunden.' });
    const { titel, beschreibung, bild_url, sortierung, aktiv, artikel_id, rolle } = req.body;
    const { rows } = await query(
      `UPDATE buchung_leistungen SET artikel_id=$1, rolle=$2, titel=$3, beschreibung=$4, bild_url=$5, sortierung=$6, aktiv=$7 WHERE id=$8 RETURNING *`,
      [artikel_id || cur.artikel_id, ['haupt', 'zusatz'].includes(rolle) ? rolle : cur.rolle,
       titel !== undefined ? titel : cur.titel, beschreibung !== undefined ? beschreibung : cur.beschreibung,
       bild_url !== undefined ? bild_url : cur.bild_url, sortierung != null ? sortierung : cur.sortierung,
       aktiv !== undefined ? !!aktiv : cur.aktiv, req.params.id]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});
router.delete('/leistungen/:id', async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM buchung_leistungen WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json({ message: 'Gelöscht.' });
  } catch (e) { next(e); }
});

// ── Design / Typografie ──
const DESIGN_DEFAULT = {
  font_head: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif",
  font_body: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif",
  akzent: '#eab308', akzent_ink: '#171717', dunkel: '#171717', skala: 1
};
function saeubereFont(v) {
  // Nur fuer font-family zulaessige Zeichen behalten -> keine CSS-Injektion in :root
  return String(v || '').replace(/[^\w\s,'"().\-]/g, '').trim().slice(0, 300);
}
router.get('/design', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT design_config FROM einstellungen ORDER BY id LIMIT 1');
    const c = (rows[0] && rows[0].design_config) || {};
    res.json(Object.assign({}, DESIGN_DEFAULT, c));
  } catch (e) { next(e); }
});
router.put('/design', async (req, res, next) => {
  try {
    const b = req.body || {};
    const hex = (v) => (/^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null);
    let skala = parseFloat(b.skala);
    if (isNaN(skala)) skala = 1;
    skala = Math.min(1.6, Math.max(0.7, skala));
    const cfg = {
      font_head: saeubereFont(b.font_head) || DESIGN_DEFAULT.font_head,
      font_body: saeubereFont(b.font_body) || DESIGN_DEFAULT.font_body,
      akzent: hex(b.akzent) || DESIGN_DEFAULT.akzent,
      akzent_ink: hex(b.akzent_ink) || DESIGN_DEFAULT.akzent_ink,
      dunkel: hex(b.dunkel) || DESIGN_DEFAULT.dunkel,
      skala: skala
    };
    const upd = await query(
      'UPDATE einstellungen SET design_config=$1 WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1) RETURNING id',
      [JSON.stringify(cfg)]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Einstellungen nicht gefunden.' });
    await regenerate();
    res.json({ message: 'Design gespeichert.', design: cfg });
  } catch (e) { next(e); }
});

// ── Abschnitt duplizieren ──
router.post('/sektionen/:id/duplicate', async (req, res, next) => {
  try {
    const cur = (await query('SELECT * FROM homepage_sektionen WHERE id=$1', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Abschnitt nicht gefunden.' });
    if (['hero', 'oeffnungszeiten', 'kontakt'].indexOf(cur.typ) !== -1)
      return res.status(400).json({ error: 'Dieser Abschnitt kann nicht dupliziert werden.' });
    const { rows } = await query(
      `INSERT INTO homepage_sektionen (typ, sortierung, headline, subline, inhalt, bild_url, bild_alt, cta_text, cta_url, sichtbar, buchung_artikel_id, daten)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [cur.typ, cur.sortierung + 1, cur.headline ? 'Kopie: ' + cur.headline : cur.headline, cur.subline, cur.inhalt,
       cur.bild_url, cur.bild_alt, cur.cta_text, cur.cta_url, cur.sichtbar, cur.buchung_artikel_id,
       cur.daten ? JSON.stringify(cur.daten) : null]
    );
    await regenerate();
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ── Medien-Uebersicht (hochgeladene Bilder, mit Nutzungserkennung) ──
router.get('/medien', async (req, res, next) => {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return res.json([]);
    // Verwendungs-Map: URL -> Liste von Orten, an denen das Bild vorkommt
    const usage = {};
    const add = function (u, label) { if (!u) return; (usage[u] = usage[u] || []).push(label); };
    (await query("SELECT bild_url, headline, typ FROM homepage_sektionen WHERE bild_url IS NOT NULL")).rows.forEach(function (r) {
      add(r.bild_url, 'Abschnitt „' + (r.headline || r.typ) + '"');
    });
    (await query("SELECT bl.bild_url, a.name FROM buchung_leistungen bl LEFT JOIN artikel a ON a.id=bl.artikel_id WHERE bl.bild_url IS NOT NULL")).rows.forEach(function (r) {
      add(r.bild_url, 'Leistung „' + (r.name || 'Buchung') + '"');
    });
    (await query("SELECT headline, daten FROM homepage_sektionen WHERE typ='galerie'")).rows.forEach(function (r) {
      if (r.daten && Array.isArray(r.daten.bilder)) r.daten.bilder.forEach(function (u) { add(u, 'Galerie „' + (r.headline || 'Galerie') + '"'); });
    });
    const se = (await query("SELECT seo_config FROM einstellungen ORDER BY id LIMIT 1")).rows[0];
    if (se && se.seo_config && se.seo_config.og_bild) add(se.seo_config.og_bild, 'SEO-Vorschaubild');
    const files = fs.readdirSync(UPLOAD_DIR).filter(function (f) { return /\.(jpe?g|png|webp|gif)$/i.test(f); });
    const list = files.map(function (f) {
      let st = { size: 0, mtimeMs: 0 }; try { st = fs.statSync(path.join(UPLOAD_DIR, f)); } catch (e) {}
      const verwendung = usage['/uploads/' + f] || [];
      return { datei: f, url: '/uploads/' + f, groesse: st.size, benutzt: verwendung.length > 0, verwendung: verwendung, mtime: st.mtimeMs };
    }).sort(function (a, b) { return b.mtime - a.mtime; });
    res.json(list);
  } catch (e) { next(e); }
});
router.delete('/medien/:datei', async (req, res, next) => {
  try {
    const name = req.params.datei;
    if (!/^[\w.\-]+\.(jpe?g|png|webp|gif)$/i.test(name) || name.indexOf('..') !== -1)
      return res.status(400).json({ error: 'Ungültiger Dateiname.' });
    const p = path.join(UPLOAD_DIR, name);
    if (p.indexOf(UPLOAD_DIR + path.sep) !== 0) return res.status(400).json({ error: 'Ungültiger Pfad.' });
    if (fs.existsSync(p)) fs.unlinkSync(p);
    res.json({ message: 'Gelöscht.' });
  } catch (e) { next(e); }
});

// ── SEO (Titel, Meta-Beschreibung, OG-Bild) ──
function saeubereText(v, max) { return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/<[^>]*>/g, '').trim().slice(0, max); }
router.get('/seo', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT seo_config FROM einstellungen ORDER BY id LIMIT 1');
    res.json((rows[0] && rows[0].seo_config) || {});
  } catch (e) { next(e); }
});
router.put('/seo', async (req, res, next) => {
  try {
    const b = req.body || {};
    const cfg = {
      titel: saeubereText(b.titel, 120),
      beschreibung: saeubereText(b.beschreibung, 320),
      og_bild: /^\/uploads\/[\w.\-\/]+$/.test(b.og_bild || '') ? b.og_bild : ''
    };
    const upd = await query(
      'UPDATE einstellungen SET seo_config=$1 WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1) RETURNING id',
      [JSON.stringify(cfg)]
    );
    if (!upd.rows.length) return res.status(404).json({ error: 'Einstellungen nicht gefunden.' });
    await regenerate();
    res.json({ message: 'SEO gespeichert.', seo: cfg });
  } catch (e) { next(e); }
});

// ── Schriften (Upload, selbst gehostet) ──
router.get('/fonts', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT id, label, familie, datei, format, erstellt_am FROM homepage_fonts ORDER BY erstellt_am');
    res.json(rows);
  } catch (e) { next(e); }
});
// Schriftformat anhand der Datei-Signatur bestimmen (verhindert falsche/gefaehrliche Uploads)
function fontFormat(buf) {
  if (buf.length < 4) return null;
  const s = buf.toString('latin1', 0, 4);
  if (s === 'wOF2') return { css: 'woff2', ext: 'woff2' };
  if (s === 'wOFF') return { css: 'woff', ext: 'woff' };
  if (s === 'OTTO') return { css: 'opentype', ext: 'otf' };
  if (s === 'true' || s === 'ttcf') return { css: 'truetype', ext: 'ttf' };
  if (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) return { css: 'truetype', ext: 'ttf' };
  return null;
}
router.post('/fonts', async (req, res, next) => {
  try {
    const { label, data } = req.body || {};
    if (!label || !String(label).trim()) return res.status(400).json({ error: 'Bitte einen Namen für die Schrift angeben.' });
    const m = /^(?:data:[^;]*;base64,)?([A-Za-z0-9+/=\s]+)$/.exec(data || '');
    if (!m) return res.status(400).json({ error: 'Ungültige Schriftdatei.' });
    const buf = Buffer.from(m[1].replace(/\s/g, ''), 'base64');
    if (buf.length < 200) return res.status(400).json({ error: 'Schriftdatei ist leer oder beschädigt.' });
    if (buf.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Schriftdatei zu groß (max. 3 MB). Bitte WOFF2 verwenden.' });
    const fmt = fontFormat(buf);
    if (!fmt) return res.status(400).json({ error: 'Kein gültiges Schriftformat (erlaubt: WOFF2, WOFF, TTF, OTF).' });
    if (!fs.existsSync(FONT_DIR)) fs.mkdirSync(FONT_DIR, { recursive: true });
    const familie = String(label).replace(/[^\w\s\-]/g, '').trim().slice(0, 40) + '-' + Date.now().toString(36).slice(-4);
    const datei = 'font-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.' + fmt.ext;
    fs.writeFileSync(path.join(FONT_DIR, datei), buf);
    const { rows } = await query(
      'INSERT INTO homepage_fonts (label, familie, datei, format) VALUES ($1,$2,$3,$4) RETURNING id, label, familie, datei, format',
      [String(label).trim().slice(0, 60), familie, datei, fmt.css]
    );
    await regenerate();
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});
router.delete('/fonts/:id', async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM homepage_fonts WHERE id=$1 RETURNING datei', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Schrift nicht gefunden.' });
    try { fs.unlinkSync(path.join(FONT_DIR, rows[0].datei)); } catch (e) { /* Datei evtl. schon weg */ }
    await regenerate();
    res.json({ message: 'Schrift gelöscht.' });
  } catch (e) { next(e); }
});

module.exports = router;
