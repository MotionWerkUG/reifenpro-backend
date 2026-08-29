const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../db/index');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const ROUNDS = () => parseInt(process.env.BCRYPT_ROUNDS) || 12;
const ROLLEN = ['admin', 'mitarbeiter'];

// Sperrt alle aktiven Admin-Zeilen in fester Reihenfolge (FOR UPDATE) und gibt ihre IDs zurueck.
// Muss innerhalb einer Transaktion laufen: serialisiert parallele "letzter Admin"-Operationen
// deadlockfrei (konsistente Lock-Reihenfolge), damit der Schutz-Check nicht per Race umgangen wird.
async function sperreAktiveAdmins(client) {
  const { rows } = await client.query(
    "SELECT id FROM users WHERE rolle='admin' AND aktiv=true ORDER BY id FOR UPDATE");
  return rows.map((r) => r.id);
}

// Normalisiert einen eingehenden aktiv-Wert strikt zu Boolean (verhindert Umgehung via "0"/"false"/NULL).
function istAktiv(v) { return v === true || v === 'true' || v === 1 || v === '1'; }

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
    const rolleClean = rolle || 'mitarbeiter';
    if (!ROLLEN.includes(rolleClean))
      return res.status(400).json({ error: 'Ungültige Rolle.' });
    const hash = await bcrypt.hash(passwort, ROUNDS());
    const { rows } = await query(
      'INSERT INTO users (email,password,vorname,nachname,rolle) VALUES ($1,$2,$3,$4,$5) RETURNING id,email,vorname,nachname,rolle,aktiv',
      [email.toLowerCase().trim(), hash, vorname.trim(), nachname.trim(), rolleClean]
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
    if (rolle !== undefined && !ROLLEN.includes(rolle))
      return res.status(400).json({ error: 'Ungültige Rolle.' });
    if (!email) return res.status(400).json({ error: 'E-Mail erforderlich.' });
    // Check + UPDATE in einer Transaktion mit gesperrtem Admin-Set (kein TOCTOU-Race).
    const out = await withTransaction(async (client) => {
      const aktiveAdminIds = await sperreAktiveAdmins(client);
      const ziel = (await client.query('SELECT rolle, aktiv FROM users WHERE id=$1', [req.params.id])).rows[0];
      if (!ziel) return { code: 404, body: { error: 'User nicht gefunden.' } };
      // Fehlende Felder = keine Aenderung (Ist-Wert behalten); aktiv strikt zu Boolean normalisieren.
      const rolleNorm = rolle === undefined ? ziel.rolle : rolle;
      const aktivNorm = aktiv === undefined ? ziel.aktiv : istAktiv(aktiv);
      // Letzter-Admin-Schutz: faellt dieser aktive Admin aus dem Pool und bliebe keiner -> blockieren.
      if (ziel.rolle === 'admin' && ziel.aktiv && !(rolleNorm === 'admin' && aktivNorm === true)) {
        const andere = aktiveAdminIds.filter((id) => id !== req.params.id).length;
        if (andere === 0)
          return { code: 400, body: { error: 'Der letzte aktive Administrator kann nicht degradiert oder deaktiviert werden.' } };
      }
      const { rows } = await client.query(
        'UPDATE users SET vorname=$1,nachname=$2,email=$3,rolle=$4,aktiv=$5 WHERE id=$6 RETURNING id,email,vorname,nachname,rolle,aktiv',
        [vorname, nachname, email.toLowerCase().trim(), rolleNorm, aktivNorm, req.params.id]
      );
      if (!rows.length) return { code: 404, body: { error: 'User nicht gefunden.' } };
      return { code: 200, body: rows[0] };
    });
    if (out.code !== 200) return res.status(out.code).json(out.body);
    await auditLog({ userId: req.user.id, aktion: 'user.geaendert', tabelle: 'users', datensatzId: req.params.id, req });
    res.json(out.body);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(400).json({ error: 'Eigenen Account nicht loeschbar.' });
    // Check + DELETE in einer Transaktion mit gesperrtem Admin-Set (kein TOCTOU-Race).
    const out = await withTransaction(async (client) => {
      const aktiveAdminIds = await sperreAktiveAdmins(client);
      const ziel = (await client.query('SELECT rolle, aktiv FROM users WHERE id=$1', [req.params.id])).rows[0];
      if (!ziel) return { code: 404, body: { error: 'User nicht gefunden.' } };
      if (ziel.rolle === 'admin' && ziel.aktiv) {
        const andere = aktiveAdminIds.filter((id) => id !== req.params.id).length;
        if (andere === 0)
          return { code: 400, body: { error: 'Der letzte aktive Administrator kann nicht gelöscht werden.' } };
      }
      // Spuren des Kontos: auf users zeigen neun Fremdschluessel, sieben davon blockierend
      // (audit_log, kunden, einlagerungen x2, kunden_dokumente, rechnungen, dsgvo_anfragen).
      // Schon ein einziger Login erzeugt einen audit_log-Eintrag. Diese Spur ist der Nachweis,
      // WER etwas getan hat (bei rechnungen.erstellt_von auch GoBD-relevant) und darf NICHT
      // mitgeloescht werden. Statt in eine FK-Verletzung (HTTP 500) zu laufen, sagen wir
      // klar, dass hier nur das Deaktivieren bleibt — der Zugang ist damit genauso weg.
      const spuren = (await client.query(
        `SELECT (SELECT COUNT(*) FROM audit_log        WHERE user_id=$1)
              + (SELECT COUNT(*) FROM kunden           WHERE erstellt_von=$1)
              + (SELECT COUNT(*) FROM einlagerungen    WHERE erstellt_von=$1 OR geaendert_von=$1)
              + (SELECT COUNT(*) FROM kunden_dokumente WHERE erstellt_von=$1)
              + (SELECT COUNT(*) FROM rechnungen       WHERE erstellt_von=$1)
              + (SELECT COUNT(*) FROM dsgvo_anfragen   WHERE bearbeitet_von=$1)
              + (SELECT COUNT(*) FROM einlagerung_platz_historie WHERE geaendert_von=$1) AS cnt`,
        [req.params.id])).rows[0].cnt;
      if (parseInt(spuren, 10) > 0)
        return { code: 409, body: { error: 'Dieser Zugang hat bereits Vorgänge erfasst und kann nicht gelöscht werden — die Protokollspur muss nachvollziehbar bleiben. Deaktiviere den Zugang stattdessen: die Anmeldung ist damit sofort gesperrt.', nur_deaktivierbar: true } };
      await client.query('DELETE FROM refresh_tokens WHERE user_id=$1', [req.params.id]);
      const { rows } = await client.query('DELETE FROM users WHERE id=$1 RETURNING id,email', [req.params.id]);
      if (!rows.length) return { code: 404, body: { error: 'User nicht gefunden.' } };
      return { code: 200, body: { message: rows[0].email + ' geloescht.' } };
    });
    if (out.code !== 200) return res.status(out.code).json(out.body);
    await auditLog({ userId: req.user.id, aktion: 'user.geloescht', tabelle: 'users', datensatzId: req.params.id, req });
    res.json(out.body);
  } catch (err) {
    // Sicherheitsnetz, falls doch eine Referenz aus einer neuen Tabelle dazukommt:
    // lieber eine verstaendliche 409 als "Interner Serverfehler".
    if (err && err.code === '23503')
      return res.status(409).json({ error: 'Dieser Zugang hat bereits Vorgänge erfasst und kann nicht gelöscht werden. Deaktiviere ihn stattdessen.', nur_deaktivierbar: true });
    next(err);
  }
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
