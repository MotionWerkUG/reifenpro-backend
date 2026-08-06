'use strict';
const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate } = require('../middleware/auth');

// GET /api/aktivitaet — letzte Ereignisse fuers Admin-Dashboard
router.get('/', authenticate, async (req, res, next) => {
  try {
    const ev = [];

    const regs = await query(
      `SELECT id, vorname, nachname, portal_registriert_am AS zeit
       FROM kunden WHERE portal_registriert_am IS NOT NULL
       ORDER BY portal_registriert_am DESC LIMIT 10`
    );
    regs.rows.forEach(function (r) {
      ev.push({ zeit: r.zeit, typ: 'registrierung', kunden_id: r.id,
        text: 'Neue Registrierung: ' + ((r.vorname || '') + ' ' + (r.nachname || '')).trim() });
    });

    const bk = await query(
      `SELECT t.id, to_char(t.datum,'DD.MM.YYYY') AS datum, t.uhrzeit_von, t.erstellt_am AS zeit,
              t.termin_typ, k.vorname, k.nachname, t.kunden_id
       FROM termine t LEFT JOIN kunden k ON k.id = t.kunden_id
       WHERE t.portal_buchung = true ORDER BY t.erstellt_am DESC LIMIT 10`
    );
    bk.rows.forEach(function (r) {
      const name = ((r.vorname || '') + ' ' + (r.nachname || '')).trim() || 'Kunde';
      ev.push({ zeit: r.zeit, typ: 'buchung', kunden_id: r.kunden_id,
        text: 'Online-Buchung: ' + name + ' — ' + (r.termin_typ || 'Termin') + ' am ' + r.datum + ' ' + String(r.uhrzeit_von || '').substring(0, 5) });
    });

    const einl = await query(
      `SELECT e.id, e.beleg_nr, e.erstellt_am AS zeit, e.kunden_id, k.vorname, k.nachname
       FROM einlagerungen e LEFT JOIN kunden k ON k.id = e.kunden_id
       ORDER BY e.erstellt_am DESC LIMIT 10`
    );
    einl.rows.forEach(function (r) {
      const name = ((r.vorname || '') + ' ' + (r.nachname || '')).trim() || 'Kunde';
      ev.push({ zeit: r.zeit, typ: 'einlagerung', kunden_id: r.kunden_id,
        text: 'Einlagerung ' + (r.beleg_nr || '') + ': ' + name });
    });

    ev.sort(function (a, b) { return new Date(b.zeit) - new Date(a.zeit); });
    res.json(ev.slice(0, 15));
  } catch (e) { next(e); }
});

module.exports = router;
