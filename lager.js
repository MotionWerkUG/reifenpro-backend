'use strict';
const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');

// GET /api/lager — alle Lagerorte mit Regalen und Belegung
router.get('/', authenticate, requireStaff, async (req, res, next) => {
  try {
    const orte = await query(
      'SELECT * FROM lager_orte WHERE aktiv=true ORDER BY name'
    );
    const regale = await query(
      'SELECT * FROM lager_regale WHERE aktiv=true ORDER BY ort_id, name'
    );
    const belegt = await query(
      "SELECT lagerplatz FROM einlagerungen WHERE status!='Abgeholt'"
    );
    const belegtSet = new Set(belegt.rows.map(r => r.lagerplatz));

    const result = orte.rows.map(function(ort) {
      const ortRegale = regale.rows.filter(function(r) {
        return r.ort_id === ort.id;
      }).map(function(regal) {
        const plaetze = [];
        for (var i = regal.plaetze_von; i <= regal.plaetze_bis; i++) {
          var pid = ort.name + '/' + regal.name + '/' + String(i).padStart(3,'0');
          plaetze.push({ nr: i, id: pid, belegt: belegtSet.has(pid) });
        }
        return Object.assign({}, regal, {
          plaetze_total: regal.plaetze_bis - regal.plaetze_von + 1,
          plaetze_belegt: plaetze.filter(function(p) { return p.belegt; }).length,
          plaetze_frei: plaetze.filter(function(p) { return !p.belegt; }).length,
        });
      });
      return Object.assign({}, ort, { regale: ortRegale });
    });

    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/lager/naechster-freier — automatisch naechsten freien Platz finden
router.get('/naechster-freier', authenticate, requireStaff, async (req, res, next) => {
  try {
    const regale = await query(
      'SELECT r.*, o.name AS ort_name FROM lager_regale r JOIN lager_orte o ON r.ort_id=o.id WHERE r.aktiv=true AND o.aktiv=true ORDER BY o.name, r.name, r.plaetze_von'
    );
    const belegt = await query(
      "SELECT lagerplatz FROM einlagerungen WHERE status!='Abgeholt'"
    );
    const belegtSet = new Set(belegt.rows.map(function(r) { return r.lagerplatz; }));

    for (var reg of regale.rows) {
      for (var i = reg.plaetze_von; i <= reg.plaetze_bis; i++) {
        var pid = reg.ort_name + '/' + reg.name + '/' + String(i).padStart(3,'0');
        if (!belegtSet.has(pid)) {
          return res.json({ lagerplatz: pid, verfuegbar: true });
        }
      }
    }
    res.json({ lagerplatz: null, verfuegbar: false, message: 'Keine freien Plaetze.' });
  } catch (err) { next(err); }
});

// GET /api/lager/stammplatz/:kundenId — Stammplatz des Kunden finden
router.get('/stammplatz/:kundenId', authenticate, requireStaff, async (req, res, next) => {
  try {
    // Frühere Plätze des Kunden (aus abgeholten Einlagerungen), je Platz der jüngste Zeitpunkt
    const prev = await query(
      `SELECT lagerplatz, MAX(COALESCE(abgeholt_am, erstellt_am)) AS zuletzt
       FROM einlagerungen
       WHERE kunden_id=$1 AND status='Abgeholt' AND lagerplatz IS NOT NULL
       GROUP BY lagerplatz ORDER BY zuletzt DESC`,
      [req.params.kundenId]
    );
    if (!prev.rows.length) return res.json({ stammplatz: null });

    // Aktuell belegte Plätze (alles ausser Abgeholt) ermitteln
    const kandidaten = prev.rows.map(function (r) { return r.lagerplatz; });
    const belegt = await query(
      "SELECT DISTINCT lagerplatz FROM einlagerungen WHERE lagerplatz = ANY($1) AND status!='Abgeholt'",
      [kandidaten]
    );
    const belegtSet = new Set(belegt.rows.map(function (r) { return r.lagerplatz; }));

    // Jüngster früherer Platz, der aktuell frei ist (berücksichtigt mehrere Radsätze)
    const frei = prev.rows.find(function (r) { return !belegtSet.has(r.lagerplatz); });
    if (frei) return res.json({ stammplatz: frei.lagerplatz, verfuegbar: true });
    // Keiner frei -> jüngsten als Hinweis zurückgeben (belegt)
    res.json({ stammplatz: prev.rows[0].lagerplatz, verfuegbar: false });
  } catch (err) { next(err); }
});

// POST /api/lager/orte — neuen Lagerort anlegen
router.post('/orte', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, beschreibung } = req.body;
    if (!name) return res.status(400).json({ error: 'Name ist Pflicht.' });
    const { rows } = await query(
      'INSERT INTO lager_orte (name, beschreibung) VALUES ($1,$2) RETURNING *',
      [name.trim(), beschreibung || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/lager/regale — neues Regal anlegen
router.post('/regale', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { ort_id, name, plaetze_von, plaetze_bis } = req.body;
    if (!ort_id || !name) return res.status(400).json({ error: 'ort_id und name sind Pflicht.' });
    const { rows } = await query(
      'INSERT INTO lager_regale (ort_id, name, plaetze_von, plaetze_bis) VALUES ($1,$2,$3,$4) RETURNING *',
      [ort_id, name.trim(), parseInt(plaetze_von)||1, parseInt(plaetze_bis)||10]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/lager/orte/:id
router.delete('/orte/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await query('UPDATE lager_orte SET aktiv=false WHERE id=$1', [req.params.id]);
    res.json({ message: 'Lagerort deaktiviert.' });
  } catch (err) { next(err); }
});

// DELETE /api/lager/regale/:id
router.delete('/regale/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await query('UPDATE lager_regale SET aktiv=false WHERE id=$1', [req.params.id]);
    res.json({ message: 'Regal deaktiviert.' });
  } catch (err) { next(err); }
});

module.exports = router;
