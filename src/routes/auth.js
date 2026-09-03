const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { query }    = require('../db/index');
const { authenticate } = require('../middleware/auth');
const { auditLog }     = require('../middleware/errorHandler');

// Konstanter, gueltiger bcrypt-Hash fuer Timing-Angleich bei unbekannter E-Mail (verhindert User-Enumeration, analog Portal).
const DUMMY_HASH = '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';

// jti: eigene Kennung je Anmeldung. Ohne sie liesse sich ein Merkmal nicht zurueckrufen --
// es ist signiert und traegt seinen Zustand selbst. Das Abmelden vermerkt genau diese Kennung,
// trifft also NUR diese eine Sitzung: Wer am Telefon angemeldet ist, bleibt es, wenn er sich
// am Tresen abmeldet.
const makeToken = (userId) =>
  jwt.sign({ userId, jti: crypto.randomUUID() }, process.env.JWT_SECRET,
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
    const user = rows[0];
    // Immer einen bcrypt-Vergleich ausfuehren (Dummy-Hash bei unbekannter E-Mail),
    // damit die Antwortzeit die Konto-Existenz nicht verraet.
    const ok = await bcrypt.compare(passwort, user ? user.password : DUMMY_HASH);
    if (!user || !ok)
      return res.status(401).json({ error: 'E-Mail oder Passwort falsch.' });
    // Alt-Hash mit abweichendem bcrypt-Kostenfaktor transparent auf den aktuellen Faktor anheben.
    // Sonst verraet die kuerzere Vergleichszeit solcher Konten weiterhin deren Existenz (Timing-Enumeration).
    // passwort_geaendert_am wird bewusst NICHT gesetzt, damit das gerade ausgestellte Token gueltig bleibt.
    const aktuellerCost = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const hashCost = parseInt((user.password.match(/^\$2[aby]\$(\d{2})\$/) || [])[1], 10);
    if (hashCost && hashCost !== aktuellerCost) {
      try {
        const neuerHash = await bcrypt.hash(passwort, aktuellerCost);
        await query('UPDATE users SET password=$1 WHERE id=$2', [neuerHash, user.id]);
      } catch (e) { console.error('[Login-Rehash]', e.message); }
    }
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
    // Diese Sitzung ungueltig machen. Vorher blieb das Merkmal nach dem Abmelden acht Stunden
    // lang gueltig -- wer es abgegriffen hatte, kam weiter hinein.
    if (req.tokenJti && req.tokenAblauf) {
      await query(
        'INSERT INTO abgemeldete_sitzungen (jti, user_id, ablauf) VALUES ($1,$2,$3) ON CONFLICT (jti) DO NOTHING',
        [req.tokenJti, req.user.id, new Date(req.tokenAblauf * 1000)]);
    }
    // Erneuerungsmerkmale dieses Nutzers ebenfalls entwerten. Frueher wurde nur eines geloescht,
    // und auch das nur, wenn die Oberflaeche es mitschickte -- was sie nicht tat. Sie sind
    // 30 Tage gueltig; ein vergessenes waere der laengere Weg zurueck ins System.
    await query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.user.id]).catch(() => {});
    await auditLog({ userId: req.user.id, aktion: 'auth.logout', req });
    res.json({ message: 'Erfolgreich abgemeldet.' });
  } catch (err) { next(err); }
});

// /me liefert zusaetzlich die sichtbaren Bereiche der Rolle. Die Oberflaeche baut ihr Menue
// daraus -- aus DERSELBEN Quelle, aus der der Torwaechter sperrt. Zwei getrennte Listen (eine
// fuer die Sichtbarkeit, eine fuer die Sperre) waeren zwei Wahrheiten, die irgendwann
// auseinanderlaufen; genau das haben wir an anderer Stelle mehrfach erlebt.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const rechte = require('../lib/rechte');
    res.json({ user: req.user, bereiche: await rechte.sichtbareBereiche(req.user.rolle) });
  } catch (e) { next(e); }
});

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
