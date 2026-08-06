const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query } = require('../db/index');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const ROUNDS = () => parseInt(process.env.BCRYPT_ROUNDS) || 12;

router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id,email,vorname,nachname,rolle,aktiv,letzter_login,erstellt_am FROM users ORDER BY erstellt_am'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { email, passwort, vorname, nachname, rolle } = req.body;
    if (!email || !passwort || !vorname || !nachname)
      return res.status(400).json({ error: 'Alle Felder sind Pflicht.' });
    if (passwort.length < 8)
      return res.status(400).json({ error: 'Passwort mind. 8 Zeichen.' });
    const hash = await bcrypt.hash(passwort, ROUNDS());
    const { rows } = await query(
      'INSERT INTO users (email,password,vorname,nachname,rolle) VALUES ($1,$2,$3,$4,$5) RETURNING id,email,vorname,nachname,rolle,aktiv',
      [email.toLowerCase().trim(), hash, vorname.trim(), nachname.trim(), rolle || 'mitarbeiter']
    );
    await auditLog({ userId: req.user.id, aktion: 'user.erstellt', tabelle: 'users', datensatzId: rows[0].id, req });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'E-Mail bereits vergeben.' });
    next(err);
  }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { vorname, nachname, email, rolle, aktiv } = req.body;
    const { rows } = await query(
      'UPDATE users SET vorname=$1,nachname=$2,email=$3,rolle=$4,aktiv=$5 WHERE id=$6 RETURNING id,email,vorname,nachname,rolle,aktiv',
      [vorname, nachname, email.toLowerCase().trim(), rolle, aktiv, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User nicht gefunden.' });
    await auditLog({ userId: req.user.id, aktion: 'user.geaendert', tabelle: 'users', datensatzId: req.params.id, req });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(400).json({ error: 'Eigenen Account nicht loeschbar.' });
    await query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.params.id]);
    const { rows } = await query('DELETE FROM users WHERE id=$1 RETURNING id,email', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'User nicht gefunden.' });
    await auditLog({ userId: req.user.id, aktion: 'user.geloescht', tabelle: 'users', datensatzId: req.params.id, req });
    res.json({ message: rows[0].email + ' geloescht.' });
  } catch (err) { next(err); }
});

router.post('/mein-passwort', authenticate, async (req, res, next) => {
  try {
    const { altesPasswort, neuesPasswort } = req.body;
    if (!altesPasswort || !neuesPasswort)
      return res.status(400).json({ error: 'Beide Passwoerter erforderlich.' });
    if (neuesPasswort.length < 8)
      return res.status(400).json({ error: 'Mind. 8 Zeichen.' });
    const { rows } = await query('SELECT password FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User nicht gefunden.' });
    const ok = await bcrypt.compare(altesPasswort, rows[0].password);
    if (!ok) return res.status(401).json({ error: 'Altes Passwort falsch.' });
    const hash = await bcrypt.hash(neuesPasswort, ROUNDS());
    await query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.user.id]);
    await query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.user.id]);
    res.json({ message: 'Passwort geaendert. Bitte neu einloggen.' });
  } catch (err) { next(err); }
});

router.post('/:id/passwort', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { neuesPasswort } = req.body;
    if (!neuesPasswort || neuesPasswort.length < 8)
      return res.status(400).json({ error: 'Mind. 8 Zeichen.' });
    const hash = await bcrypt.hash(neuesPasswort, ROUNDS());
    await query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.params.id]);
    await query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.params.id]);
    await auditLog({ userId: req.user.id, aktion: 'user.passwort_reset', tabelle: 'users', datensatzId: req.params.id, req });
    res.json({ message: 'Passwort zurueckgesetzt.' });
  } catch (err) { next(err); }
});

module.exports = router;
