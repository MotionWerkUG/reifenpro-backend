const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { query }    = require('../db/index');
const { authenticate } = require('../middleware/auth');
const { auditLog }     = require('../middleware/errorHandler');

const makeToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

const makeRefresh = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' });

router.post('/login', async (req, res, next) => {
  try {
    const { email, passwort } = req.body;
    if (!email || !passwort)
      return res.status(400).json({ error: 'E-Mail und Passwort erforderlich.' });
    const { rows } = await query(
      'SELECT * FROM users WHERE email=$1 AND aktiv=true',
      [email.toLowerCase().trim()]
    );
    if (!rows.length || !(await bcrypt.compare(passwort, rows[0].password)))
      return res.status(401).json({ error: 'E-Mail oder Passwort falsch.' });
    const user    = rows[0];
    const token   = makeToken(user.id);
    const refresh = makeRefresh(user.id);
    const ablauf  = new Date(Date.now() + 30 * 86400000);
    await query(
      'INSERT INTO refresh_tokens (user_id,token,ablauf_am,ip_adresse) VALUES ($1,$2,$3,$4)',
      [user.id, refresh, ablauf, req.ip]
    );
    await query('UPDATE users SET letzter_login=NOW() WHERE id=$1', [user.id]);
    await auditLog({ userId: user.id, aktion: 'auth.login', req });
    res.json({
      token,
      refreshToken: refresh,
      user: { id: user.id, email: user.email, vorname: user.vorname,
              nachname: user.nachname, rolle: user.rolle }
    });
  } catch (err) { next(err); }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Token fehlt.' });
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Token ungültig oder abgelaufen.' });
    }
    const { rows } = await query(
      'SELECT * FROM refresh_tokens WHERE token=$1 AND ablauf_am>NOW()',
      [refreshToken]
    );
    if (!rows.length) return res.status(401).json({ error: 'Token nicht gefunden.' });
    const newToken   = makeToken(decoded.userId);
    const newRefresh = makeRefresh(decoded.userId);
    const ablauf     = new Date(Date.now() + 30 * 86400000);
    await query('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken]);
    await query(
      'INSERT INTO refresh_tokens (user_id,token,ablauf_am) VALUES ($1,$2,$3)',
      [decoded.userId, newRefresh, ablauf]
    );
    res.json({ token: newToken, refreshToken: newRefresh });
  } catch (err) { next(err); }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken)
      await query('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken]);
    await auditLog({ userId: req.user.id, aktion: 'auth.logout', req });
    res.json({ message: 'Erfolgreich abgemeldet.' });
  } catch (err) { next(err); }
});

router.get('/me', authenticate, (req, res) =>
  res.json({ user: req.user })
);

// Passwort-Reset Anfrage
const resetLimiter = require('express-rate-limit')({ windowMs: 900000, max: 8, message: { error: 'Zu viele Anfragen. Bitte in einigen Minuten erneut versuchen.' } });
router.post('/passwort-reset-anfrage', resetLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ message: 'ok' });
    const { rows } = await query('SELECT * FROM users WHERE email=$1 AND aktiv=true', [email.toLowerCase().trim()]);
    if (!rows.length) return res.json({ message: 'ok' });
    const user = rows[0];
    const token = require('crypto').randomBytes(32).toString('hex');
    const ablauf = new Date(Date.now() + 3600000);
    await query('DELETE FROM passwort_reset_tokens WHERE user_id=$1', [user.id]);
    await query('INSERT INTO passwort_reset_tokens (user_id, token, ablauf_am) VALUES ($1,$2,$3)', [user.id, token, ablauf]);
    const einst = await query('SELECT * FROM einstellungen LIMIT 1');
    const f = einst.rows[0] || {};
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    const resetUrl = 'https://admin.schroeder-scholz.de/?reset=' + token;
    await transporter.sendMail({
      from: '"' + (f.firmenname || 'ReifenPro') + '" <' + process.env.SMTP_USER + '>',
      to: user.email,
      subject: 'Passwort zurücksetzen - ReifenPro',
      html: '<p>Hallo ' + user.vorname + ',</p><p>Klicken Sie auf den Link um Ihr Passwort zurückzusetzen:</p><p><a href="' + resetUrl + '">' + resetUrl + '</a></p><p>Der Link ist 1 Stunde gültig.</p><p>Falls Sie keinen Reset angefordert haben, ignorieren Sie diese E-Mail.</p>'
    });
    res.json({ message: 'ok' });
  } catch (err) { console.error('[PWReset]', err.message); res.json({ message: 'ok' }); }
});

// Reset abschliessen: neues Passwort per Token setzen
router.post('/passwort-reset', async (req, res, next) => {
  try {
    const { token, passwort } = req.body;
    if (!token || !passwort || passwort.length < 8)
      return res.status(400).json({ error: 'Token und neues Passwort (mind. 8 Zeichen) erforderlich.' });
    const { rows } = await query('SELECT * FROM passwort_reset_tokens WHERE token=$1', [token]);
    if (!rows.length || new Date(rows[0].ablauf_am) < new Date())
      return res.status(400).json({ error: 'Der Reset-Link ist ungültig oder abgelaufen.' });
    const hash = await bcrypt.hash(passwort, 12);
    await query('UPDATE users SET password=$1, passwort_geaendert_am=NOW() WHERE id=$2', [hash, rows[0].user_id]);
    await query('DELETE FROM passwort_reset_tokens WHERE user_id=$1', [rows[0].user_id]);
    await query('DELETE FROM refresh_tokens WHERE user_id=$1', [rows[0].user_id]); // alte Sitzungen beenden
    res.json({ message: 'Passwort geändert. Bitte neu anmelden.' });
  } catch (err) { next(err); }
});

module.exports = router;
