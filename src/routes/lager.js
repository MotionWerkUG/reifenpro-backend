'use strict';
const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');

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
    // Wie viele Saetze liegen je Platz? Bei gestapelten Regalen koennen es mehrere sein.
    const belegtZaehler = {};
    belegt.rows.forEach(function (r) { belegtZaehler[r.lagerplatz] = (belegtZaehler[r.lagerplatz] || 0) + 1; });

    const result = orte.rows.map(function(ort) {
      const ortRegale = regale.rows.filter(function(r) {
        return r.ort_id === ort.id;
      }).map(function(regal) {
        const kap = regal.plaetze_kapazitaet && regal.plaetze_kapazitaet > 0 ? regal.plaetze_kapazitaet : 1;
        const plaetze = [];
        for (var i = regal.plaetze_von; i <= regal.plaetze_bis; i++) {
          var pid = ort.name + '-' + regal.name + '-' + String(i).padStart(2,'0');
          // Bei gestapelten Regalen zaehlt, WIE VIELE Saetze auf dem Platz liegen. Ein Platz ist
          // erst voll, wenn die Kapazitaet erreicht ist — und nur dann darf er als belegt gelten.
          var anzahl = belegtZaehler[pid] || 0;
          plaetze.push({ nr: i, id: pid, anzahl: anzahl, kapazitaet: kap, belegt: anzahl >= kap, teilbelegt: anzahl > 0 && anzahl < kap });
        }
        return Object.assign({}, regal, {
          plaetze_kapazitaet: kap,
          plaetze_total: regal.plaetze_bis - regal.plaetze_von + 1,
          plaetze_belegt: plaetze.filter(function(p) { return p.belegt; }).length,
          plaetze_teilbelegt: plaetze.filter(function(p) { return p.teilbelegt; }).length,
          plaetze_frei: plaetze.filter(function(p) { return !p.belegt; }).length,
          saetze_gesamt: plaetze.reduce(function(a, p) { return a + p.anzahl; }, 0),
        });
      });
      return Object.assign({}, ort, { regale: ortRegale });
    });

    // Belegte Plaetze, die NICHT im konfigurierten Raster liegen, sichtbar machen (statt sie zu verstecken).
    const konfiguriert = new Set();
    regale.rows.forEach(function (r) {
      const ort = orte.rows.find(function (o) { return o.id === r.ort_id; });
      if (!ort) return;
      for (var i = r.plaetze_von; i <= r.plaetze_bis; i++) konfiguriert.add(ort.name + '-' + r.name + '-' + String(i).padStart(2, '0'));
    });
    const unzugeordnet = Array.from(belegtSet).filter(function (p) { return p && !konfiguriert.has(p); }).sort();
    if (unzugeordnet.length) {
      result.push({
        id: null, name: 'Nicht zugeordnet', beschreibung: 'Belegte Plätze außerhalb des konfigurierten Rasters', aktiv: true, unzugeordnet: true,
        regale: [{
          id: null, name: 'Sonstige',
          plaetze_total: unzugeordnet.length, plaetze_belegt: unzugeordnet.length, plaetze_frei: 0,
          plaetze: unzugeordnet.map(function (p) { return { nr: null, id: p, belegt: true }; })
        }]
      });
    }

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
    const belegtZaehler = {};
    belegt.rows.forEach(function (r) { belegtZaehler[r.lagerplatz] = (belegtZaehler[r.lagerplatz] || 0) + 1; });

    // Erst wirklich leere Plaetze anbieten, danach erst halb belegte Stapelplaetze — sonst
    // stapelt man, obwohl noch ganze Plaetze frei sind.
    var halbBelegt = null;
    for (var reg of regale.rows) {
      var kapR = reg.plaetze_kapazitaet && reg.plaetze_kapazitaet > 0 ? reg.plaetze_kapazitaet : 1;
      for (var i = reg.plaetze_von; i <= reg.plaetze_bis; i++) {
        var pid = reg.ort_name + '-' + reg.name + '-' + String(i).padStart(2,'0');
        var anz = belegtZaehler[pid] || 0;
        if (anz === 0) return res.json({ lagerplatz: pid, verfuegbar: true, kapazitaet: kapR, belegt: 0 });
        if (anz < kapR && !halbBelegt) halbBelegt = { lagerplatz: pid, verfuegbar: true, kapazitaet: kapR, belegt: anz,
          hinweis: 'Auf diesem Platz liegt bereits ein Satz — hier wird gestapelt.' };
      }
    }
    if (halbBelegt) return res.json(halbBelegt);
    res.json({ lagerplatz: null, verfuegbar: false, message: 'Keine freien Plaetze.' });
  } catch (err) { next(err); }
});

// GET /api/lager/stammplatz/:kundenId — Stammplatz des Kunden finden
router.get('/stammplatz/:kundenId', authenticate, requireStaff, async (req, res, next) => {
  try {
    // Ungueltige UUID wuerde in Postgres als 22P02 knallen -> HTTP 500. Sauber abweisen.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.kundenId || '')))
      return res.status(400).json({ error: 'Ungültige Kunden-ID.' });
    const { fahrzeug_id, einlagerung_id } = req.query;
    // Exakt: Stammplatz eines konkreten Radsatzes (Wiedereinlagerung) -> dessen letzter Platz
    if (einlagerung_id) {
      const r = (await query(
        'SELECT lagerplatz FROM einlagerungen WHERE id::text=$1 AND kunden_id=$2',
        [einlagerung_id, req.params.kundenId])).rows[0];
      if (r && r.lagerplatz) {
        const belegt = (await query(
          "SELECT 1 FROM einlagerungen WHERE lagerplatz=$1 AND status!='Abgeholt' LIMIT 1",
          [r.lagerplatz])).rows.length;
        return res.json({ stammplatz: r.lagerplatz, verfuegbar: !belegt });
      }
    }
    // Frühere Plätze des Kunden (aus abgeholten Einlagerungen), optional auf ein Fahrzeug eingegrenzt,
    // je Platz der jüngste Zeitpunkt
    const params = [req.params.kundenId];
    let filter = '';
    if (fahrzeug_id) { params.push(fahrzeug_id); filter = ` AND fahrzeug_id=$${params.length}`; }
    let prev = await query(
      `SELECT lagerplatz, MAX(COALESCE(abgeholt_am, erstellt_am)) AS zuletzt
       FROM einlagerungen
       WHERE kunden_id=$1 AND status='Abgeholt' AND lagerplatz IS NOT NULL${filter}
       GROUP BY lagerplatz ORDER BY zuletzt DESC`,
      params
    );
    // Fallback: kein Treffer fuer dieses Fahrzeug -> kundenweit suchen
    if (!prev.rows.length && fahrzeug_id) {
      prev = await query(
        `SELECT lagerplatz, MAX(COALESCE(abgeholt_am, erstellt_am)) AS zuletzt
         FROM einlagerungen
         WHERE kunden_id=$1 AND status='Abgeholt' AND lagerplatz IS NOT NULL
         GROUP BY lagerplatz ORDER BY zuletzt DESC`,
        [req.params.kundenId]
      );
    }
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
    // von/bis pruefen: "von 10 bis 1" legte bisher klaglos ein Regal an, das dauerhaft 0 Plaetze hat.
    const vonZ = req.body.plaetze_von === undefined || req.body.plaetze_von === null || req.body.plaetze_von === '' ? 1 : parseInt(req.body.plaetze_von, 10);
    const bisZ = req.body.plaetze_bis === undefined || req.body.plaetze_bis === null || req.body.plaetze_bis === '' ? 10 : parseInt(req.body.plaetze_bis, 10);
    if (!Number.isInteger(vonZ) || !Number.isInteger(bisZ) || vonZ < 0 || bisZ < vonZ)
      return res.status(400).json({ error: 'Platzbereich ungültig: „von" muss kleiner oder gleich „bis" sein.' });
    if (bisZ - vonZ > 999) return res.status(400).json({ error: 'Ein Regal darf höchstens 1000 Plätze haben.' });
    if (req.body.ort_id) {
      const ort = await query('SELECT id FROM lager_orte WHERE id::text=$1', [String(req.body.ort_id)]);
      if (!ort.rows.length) return res.status(400).json({ error: 'Lagerort nicht gefunden.' });
    }
    const { ort_id, name } = req.body;
    if (!ort_id || !name) return res.status(400).json({ error: 'ort_id und name sind Pflicht.' });
    // Wie viele Saetze duerfen uebereinander? 1 = normal, 2+ = gestapelt (Container).
    const kap = req.body.plaetze_kapazitaet === undefined ? 1 : parseInt(req.body.plaetze_kapazitaet, 10);
    if (!Number.isInteger(kap) || kap < 1 || kap > 4)
      return res.status(400).json({ error: 'Räder je Platz muss zwischen 1 und 4 liegen.' });
    const { rows } = await query(
      'INSERT INTO lager_regale (ort_id, name, plaetze_von, plaetze_bis, plaetze_kapazitaet) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [ort_id, name.trim(), vonZ, bisZ, kap]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/lager/orte/:id
// Deaktivieren (kein echtes Loeschen): betrifft moeglicherweise viele belegte Plaetze — gehoert
// deshalb ins Protokoll.
router.delete('/orte/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const belegt = (await query(
      `SELECT COUNT(*)::int AS c FROM einlagerungen e
        WHERE e.status <> 'Abgeholt'
          AND e.lagerplatz LIKE (SELECT name FROM lager_orte WHERE id::text=$1) || '-%'`,
      [String(req.params.id)])).rows[0];
    const { rows } = await query('UPDATE lager_orte SET aktiv=false WHERE id::text=$1 RETURNING id, name', [String(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Lagerort nicht gefunden.' });
    await auditLog({ userId: req.user.id, aktion: 'lagerort.deaktiviert', tabelle: 'lager_orte',
      datensatzId: rows[0].id, alteWerte: { name: rows[0].name, belegte_plaetze: belegt.c }, req });
    res.json({ message: 'Lagerort deaktiviert.', belegte_plaetze: belegt.c,
      hinweis: belegt.c ? belegt.c + ' belegte(r) Platz/Plätze erscheinen jetzt unter „Nicht zugeordnet". Über „Wieder aktivieren" rückgängig zu machen.' : undefined });
  } catch (err) { next(err); }
});

// DELETE /api/lager/regale/:id
router.delete('/regale/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const r0 = (await query('SELECT id, name FROM lager_regale WHERE id::text=$1', [String(req.params.id)])).rows[0];
    if (!r0) return res.status(404).json({ error: 'Regal nicht gefunden.' });
    await auditLog({ userId: req.user.id, aktion: 'regal.deaktiviert', tabelle: 'lager_regale',
      datensatzId: r0.id, alteWerte: { name: r0.name }, req });
    await query('UPDATE lager_regale SET aktiv=false WHERE id=$1', [req.params.id]);
    res.json({ message: 'Regal deaktiviert.' });
  } catch (err) { next(err); }
});

// Wieder aktivieren. Bisher gab es nur DELETE (= deaktivieren) und keinen Weg zurueck: ein
// versehentlich deaktivierter Lagerort war nur ueber direkten Datenbankzugriff zu retten, waehrend
// die dort liegenden Saetze im Lagerplan unter "Nicht zugeordnet" auftauchten.
router.patch('/orte/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (req.body.aktiv === undefined) return res.status(400).json({ error: 'aktiv (true/false) erforderlich.' });
    const aktiv = req.body.aktiv === true || req.body.aktiv === 'true';
    const { rows } = await query('UPDATE lager_orte SET aktiv=$1 WHERE id::text=$2 RETURNING *', [aktiv, String(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Lagerort nicht gefunden.' });
    await auditLog({ userId: req.user.id, aktion: aktiv ? 'lagerort.aktiviert' : 'lagerort.deaktiviert',
      tabelle: 'lager_orte', datensatzId: req.params.id, neueWerte: { aktiv }, req });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/regale/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (req.body.aktiv === undefined) return res.status(400).json({ error: 'aktiv (true/false) erforderlich.' });
    const aktiv = req.body.aktiv === true || req.body.aktiv === 'true';
    const { rows } = await query('UPDATE lager_regale SET aktiv=$1 WHERE id::text=$2 RETURNING *', [aktiv, String(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Regal nicht gefunden.' });
    await auditLog({ userId: req.user.id, aktion: aktiv ? 'regal.aktiviert' : 'regal.deaktiviert',
      tabelle: 'lager_regale', datensatzId: req.params.id, neueWerte: { aktiv }, req });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
