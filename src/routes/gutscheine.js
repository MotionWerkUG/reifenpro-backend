'use strict';
// Gutscheine/Aktionscodes verwalten. Liegt auf dem Server unter src/routes/gutscheine.js.
// Gemountet (nur Mitarbeiter) als /api/gutscheine.
const router = require('express').Router();
const { query, withTransaction } = require('../db/index');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');

// LESEN darf jeder Mitarbeiter: Der Rechnungseditor muss einen Gutschein anwenden koennen.
// SCHREIBEN nur der Inhaber -- siehe requireAdmin an den einzelnen Routen unten.
//
// Entscheidung des Inhabers: Gutscheine wurden frueher im Homepage-CMS angelegt und geloescht.
// Ein Gutschein ist aber kein Gestaltungselement, sondern ein Preisnachlass, der auf der Rechnung
// landet -- WINTER2026 kostet je Einlagerung 10 Euro. Wer Rabatte vergeben darf, entscheidet der
// Betrieb, nicht das Werkzeug fuer die Website. Und: Im CMS durfte das jeder Mitarbeiter.
router.use(authenticate, requireStaff);

function normCode(c) { return String(c || '').trim().toUpperCase().replace(/\s+/g, ''); }

// Liste. Liefert je Gutschein die abweichenden Saetze mit -- ohne sie zeigt die Oberflaeche
// eine Zahl, die fuer den Kunden gar nicht gilt (WINTER2026 stand mit 25 % in der Liste,
// abgerechnet wurden 25 % nur auf die Einlagerung und 10 % auf alles andere).
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM gutscheine ORDER BY erstellt_am DESC');
    const regeln = (await query(
      `SELECT r.gutschein_id, r.artikel_id, r.rabatt_prozent, a.name AS artikel_name
         FROM gutschein_regeln r
         LEFT JOIN artikel a ON a.id = r.artikel_id
        WHERE r.artikel_id IS NOT NULL
        ORDER BY a.name`)).rows;
    rows.forEach(function (g) {
      g.regeln = regeln.filter(function (r) { return r.gutschein_id === g.id; })
        .map(function (r) { return { artikel_id: r.artikel_id, artikel_name: r.artikel_name, rabatt_prozent: r.rabatt_prozent }; });
    });
    res.json(rows);
  } catch (e) { next(e); }
});

// Pruefen (fuer Rechnungs-Editor): nur gueltige aktive Codes
router.get('/pruefen/:code', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT code, rabatt_prozent, gueltig_bis FROM gutscheine
       WHERE UPPER(code)=UPPER($1) AND aktiv=true AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE)`,
      [normCode(req.params.code)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Code ungültig oder abgelaufen.' });
    // Die abweichenden Saetze gehoeren in die Antwort: Wer den Code von Hand auf eine Rechnung
    // anwendet, muss sehen, dass nicht auf jede Zeile derselbe Satz gehoert. Ohne diese Angabe
    // zog der Rechnungseditor stillschweigend EINEN Satz auf die ganze Rechnung.
    const g = rows[0];
    const regeln = (await query(
      `SELECT r.artikel_id, r.rabatt_prozent, a.name AS artikel_name
         FROM gutschein_regeln r LEFT JOIN artikel a ON a.id = r.artikel_id
        WHERE r.gutschein_id = (SELECT id FROM gutscheine WHERE UPPER(code)=UPPER($1))
          AND r.artikel_id IS NOT NULL
        ORDER BY a.name`, [normCode(req.params.code)])).rows;
    g.regeln = regeln;
    g.gestaffelt = regeln.length > 0;
    res.json(g);
  } catch (e) { next(e); }
});

// Anlegen
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const code = normCode(req.body.code);
    const rabatt = parseInt(req.body.rabatt_prozent);
    if (!code) return res.status(400).json({ error: 'Code ist Pflicht.' });
    if (!(rabatt >= 1 && rabatt <= 100)) return res.status(400).json({ error: 'Rabatt muss zwischen 1 und 100 % liegen.' });
    const exists = await query('SELECT id FROM gutscheine WHERE UPPER(code)=UPPER($1)', [code]);
    if (exists.rows.length) return res.status(409).json({ error: 'Diesen Code gibt es bereits.' });
    const { rows } = await query(
      'INSERT INTO gutscheine (code, beschreibung, rabatt_prozent, gueltig_bis, aktiv) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [code, req.body.beschreibung || null, rabatt, req.body.gueltig_bis || null, req.body.aktiv !== false]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// Aendern (aktiv-Status, Rabatt, Gueltigkeit, Beschreibung)
router.patch('/:id', requireAdmin, async (req, res, next) => {
  try {
    const cur = (await query('SELECT * FROM gutscheine WHERE id=$1', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Gutschein nicht gefunden.' });
    const rabatt = req.body.rabatt_prozent != null ? parseInt(req.body.rabatt_prozent) : cur.rabatt_prozent;
    const { rows } = await query(
      `UPDATE gutscheine SET beschreibung=$1, rabatt_prozent=$2, gueltig_bis=$3, aktiv=$4 WHERE id=$5 RETURNING *`,
      [req.body.beschreibung !== undefined ? req.body.beschreibung : cur.beschreibung,
       rabatt,
       req.body.gueltig_bis !== undefined ? (req.body.gueltig_bis || null) : cur.gueltig_bis,
       req.body.aktiv !== undefined ? !!req.body.aktiv : cur.aktiv,
       req.params.id]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// Staffelung setzen: Standardsatz + abweichende Saetze je Artikel.
//
// EIN Wert je Aussage. Frueher gab es zwei Orte fuer denselben Satz: `gutscheine.rabatt_prozent`
// und eine Regelzeile mit `artikel_id IS NULL` (Auffangsatz). Beide bedeuten "alles Uebrige".
// Stand eine Auffangzeile, war `rabatt_prozent` tot -- der Inhaber konnte die Zahl im Admin
// aendern, ohne dass sich am Preis irgendetwas bewegte. Deshalb schreibt diese Route den
// Standardsatz NUR nach `gutscheine.rabatt_prozent` und loescht Auffangzeilen. Die Aufloesung
// in lib/gutschein.js faellt genau darauf zurueck; das Ergebnis bleibt gleich, die zweite
// Wahrheit ist weg.
router.put('/:id/regeln', requireAdmin, async (req, res, next) => {
  try {
    const g = (await query('SELECT id FROM gutscheine WHERE id=$1', [req.params.id])).rows[0];
    if (!g) return res.status(404).json({ error: 'Gutschein nicht gefunden.' });
    const standard = parseInt(req.body.rabatt_prozent);
    if (!(standard >= 0 && standard <= 100)) return res.status(400).json({ error: 'Standardsatz muss zwischen 0 und 100 % liegen.' });
    const eingang = Array.isArray(req.body.regeln) ? req.body.regeln : [];
    if (eingang.length > 200) return res.status(400).json({ error: 'Zu viele Ausnahmen.' });
    const gesehen = {};
    const sauber = [];
    for (const r of eingang) {
      const aid = String(r.artikel_id || '');
      const satz = parseInt(r.rabatt_prozent);
      if (!aid) continue; // Auffangzeilen nimmt diese Route bewusst nicht entgegen
      if (!(satz >= 0 && satz <= 100)) return res.status(400).json({ error: 'Jeder Satz muss zwischen 0 und 100 % liegen.' });
      if (gesehen[aid]) return res.status(400).json({ error: 'Zu einer Leistung darf nur ein Satz hinterlegt sein.' });
      gesehen[aid] = true;
      sauber.push({ artikel_id: aid, rabatt_prozent: satz });
    }
    if (sauber.length) {
      const ids = sauber.map(function (r) { return r.artikel_id; });
      if (!ids.every(function (x) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x); })) {
        return res.status(400).json({ error: 'Ungültige Leistungs-Kennung.' });
      }
      const vorhanden = (await query('SELECT id FROM artikel WHERE id = ANY($1::uuid[])', [ids])).rows.length;
      if (vorhanden !== ids.length) return res.status(400).json({ error: 'Mindestens eine Leistung gibt es nicht (mehr).' });
    }
    await withTransaction(async (client) => {
      await client.query('UPDATE gutscheine SET rabatt_prozent=$1 WHERE id=$2', [standard, req.params.id]);
      await client.query('DELETE FROM gutschein_regeln WHERE gutschein_id=$1', [req.params.id]);
      for (const r of sauber) {
        await client.query('INSERT INTO gutschein_regeln (gutschein_id, artikel_id, rabatt_prozent) VALUES ($1,$2,$3)',
          [req.params.id, r.artikel_id, r.rabatt_prozent]);
      }
    });
    res.json({ message: 'Gespeichert.', rabatt_prozent: standard, regeln: sauber });
  } catch (e) { next(e); }
});

// Loeschen
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM gutscheine WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Gutschein nicht gefunden.' });
    res.json({ message: 'Gelöscht.' });
  } catch (e) { next(e); }
});

module.exports = router;
