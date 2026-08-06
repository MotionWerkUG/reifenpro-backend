const jwt     = require('jsonwebtoken');
const { query } = require('../db/index');

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer '))
      return res.status(401).json({ error: 'Kein Token.' });
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    const { rows } = await query(
      'SELECT id,email,vorname,nachname,rolle,aktiv,passwort_geaendert_am FROM users WHERE id=$1',
      [decoded.userId]
    );
    if (!rows.length || !rows[0].aktiv)
      return res.status(401).json({ error: 'Account gesperrt.' });
    // Nach einer Passwortaenderung aeltere Tokens ungueltig machen (5s Toleranz)
    if (rows[0].passwort_geaendert_am && decoded.iat && decoded.iat * 1000 < new Date(rows[0].passwort_geaendert_am).getTime() - 5000)
      return res.status(401).json({ error: 'Sitzung abgelaufen.', code: 'PW_CHANGED' });
    req.user = rows[0];
    next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    return res.status(401).json({ error: 'Nicht autorisiert.', code });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  if (req.user.rolle !== 'admin') return res.status(403).json({ error: 'Nur für Admins.' });
  next();
};

const requireStaff = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Nicht eingeloggt.' });
  if (!['admin','mitarbeiter'].includes(req.user.rolle))
    return res.status(403).json({ error: 'Keine Berechtigung.' });
  next();
};

module.exports = { authenticate, requireAdmin, requireStaff };
