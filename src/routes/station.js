// Unterschriften-Station: Am PC wird erfasst, das fertige Dokument geht zum Lesen und
// Unterschreiben an ein separates Geraet (iPad, spaeter ein Unterschriftenpad).
//
// Warum ein eigener Weg statt "Admin auf dem iPad oeffnen": Wer dem Kunden ein angemeldetes
// Mitarbeiterkonto in die Hand gibt, gibt ihm Kundenliste, Rechnungen und Einstellungen mit.
// Die Station bekommt deshalb ein eigenes, eng begrenztes Merkmal — sie kann ausschliesslich
// den aktuellen Auftrag lesen und eine Unterschrift zurueckgeben. Mehr kennt sie nicht.
//
// Bewusst KEINE serverseitige Dokumenterzeugung: Die Station liefert nur das Bild der
// Unterschrift, gespeichert wird weiterhin ueber den bestehenden Weg im Admin. Damit gilt
// dieselbe Pruefung (Anschrift, Dokumentart, Aufbewahrungssperre) wie bisher, an einer Stelle.
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { query } = require('../db');
const { authenticate, requireStaff } = require('../middleware/auth');

const router = express.Router();

// Ein Auftrag verfaellt, wenn er liegen bleibt — sonst zeigt das iPad morgen noch den
// Vertrag von gestern, und der naechste Kunde unterschreibt versehentlich fremde Daten.
const AUFTRAG_MINUTEN = 20;
const CODE_MINUTEN = 10;

function neuesGeheimnis() { return crypto.randomBytes(32).toString('hex'); }
function neuerCode() { return String(crypto.randomInt(100000, 1000000)); }

// ── Geraeteseite: erkennt sich ueber das Merkmal im Kopf der Anfrage ────────────────
async function stationAuth(req, res, next) {
  try {
    const g = req.headers['x-station'] || '';
    if (!g) return res.status(401).json({ error: 'Diese Station ist nicht gekoppelt.' });
    const { rows } = await query(
      'SELECT id, name, aktiv FROM signatur_stationen WHERE geheimnis=$1', [String(g)]);
    if (!rows.length || !rows[0].aktiv)
      return res.status(401).json({ error: 'Station unbekannt oder abgemeldet.', code: 'STATION_WEG' });
    await query('UPDATE signatur_stationen SET letzter_kontakt=now() WHERE id=$1', [rows[0].id]);
    req.station = rows[0];
    next();
  } catch (err) { next(err); }
}

// Der Kopplungscode hat nur sechs Stellen. Ohne Bremse liesse er sich in Minuten
// durchprobieren — und wer ihn errät, bekommt ein dauerhaft gueltiges Merkmal.
// Zehn Versuche je Viertelstunde und Absender reichen fuer Vertipper und stoppen das Raten.
const koppelBremse = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' },
});

// Kopplung: Das Geraet tauscht den im Admin angezeigten Code einmalig gegen sein Merkmal.
router.post('/koppeln', koppelBremse, async (req, res, next) => {
  try {
    const code = String((req.body && req.body.code) || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Bitte den sechsstelligen Code eingeben.' });
    const { rows } = await query(
      'SELECT id, name FROM signatur_stationen WHERE kopplungscode=$1 AND code_ablauf > now() AND aktiv=true', [code]);
    if (!rows.length) return res.status(400).json({ error: 'Code ungültig oder abgelaufen.' });
    const geheimnis = neuesGeheimnis();
    await query(
      'UPDATE signatur_stationen SET geheimnis=$1, kopplungscode=NULL, code_ablauf=NULL, gekoppelt_am=now() WHERE id=$2',
      [geheimnis, rows[0].id]);
    res.json({ station: rows[0].name, geheimnis });
  } catch (err) { next(err); }
});

// Was liegt an? Das Geraet fragt regelmaessig nach. Bewusst einfaches Nachfragen statt einer
// dauerhaften Verbindung: Ein iPad, das ueber Nacht das WLAN verliert, findet so von selbst
// zurueck, ohne dass jemand etwas neu startet.
router.get('/auftrag', stationAuth, async (req, res, next) => {
  try {
    await query("UPDATE signatur_auftraege SET status='abgelaufen' WHERE status='offen' AND ablauf_am < now()");
    const { rows } = await query(
      `SELECT id, titel, kunde_name, inhalt_html, ablauf_am FROM signatur_auftraege
        WHERE station_id=$1 AND status='offen' ORDER BY erstellt_am DESC LIMIT 1`, [req.station.id]);
    res.json({ station: req.station.name, auftrag: rows[0] || null });
  } catch (err) { next(err); }
});

router.post('/auftrag/:id/unterschrift', stationAuth, async (req, res, next) => {
  try {
    const u = (req.body && req.body.unterschrift) || '';
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]{100,}$/.test(String(u)))
      return res.status(400).json({ error: 'Keine gültige Unterschrift empfangen.' });
    const { rows } = await query(
      `UPDATE signatur_auftraege SET unterschrift=$1, status='unterschrieben', erledigt_am=now()
        WHERE id=$2 AND station_id=$3 AND status='offen' RETURNING id`,
      [String(u), req.params.id, req.station.id]);
    if (!rows.length) return res.status(409).json({ error: 'Der Auftrag ist nicht mehr offen.' });
    res.json({ message: 'Unterschrift übernommen.' });
  } catch (err) { next(err); }
});

router.post('/auftrag/:id/abbrechen', stationAuth, async (req, res, next) => {
  try {
    await query("UPDATE signatur_auftraege SET status='abgebrochen', erledigt_am=now() WHERE id=$1 AND station_id=$2 AND status='offen'",
      [req.params.id, req.station.id]);
    res.json({ message: 'Abgebrochen.' });
  } catch (err) { next(err); }
});

// ── Mitarbeiterseite ───────────────────────────────────────────────────────────────
router.get('/stationen', authenticate, requireStaff, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, aktiv, gekoppelt_am, letzter_kontakt,
              (kopplungscode IS NOT NULL AND code_ablauf > now()) AS wartet_auf_kopplung
         FROM signatur_stationen ORDER BY erstellt_am`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/stationen', authenticate, requireStaff, async (req, res, next) => {
  try {
    const name = String((req.body && req.body.name) || '').trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'Bitte einen Namen vergeben, z. B. "iPad Tresen".' });
    const code = neuerCode();
    const { rows } = await query(
      `INSERT INTO signatur_stationen (name, geheimnis, kopplungscode, code_ablauf)
       VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval) RETURNING id, name`,
      [name, neuesGeheimnis(), code, String(CODE_MINUTEN)]);
    res.status(201).json({ id: rows[0].id, name: rows[0].name, code, gueltig_minuten: CODE_MINUTEN });
  } catch (err) { next(err); }
});

// Neuer Kopplungscode, z. B. wenn das Geraet getauscht wird. Das alte Merkmal wird dabei
// ersetzt — ein verlorenes iPad verliert damit sofort den Zugang.
router.post('/stationen/:id/neuer-code', authenticate, requireStaff, async (req, res, next) => {
  try {
    const code = neuerCode();
    const { rows } = await query(
      `UPDATE signatur_stationen SET kopplungscode=$1, code_ablauf = now() + ($2 || ' minutes')::interval,
              geheimnis=$3, gekoppelt_am=NULL WHERE id=$4 RETURNING name`,
      [code, String(CODE_MINUTEN), neuesGeheimnis(), req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Station nicht gefunden.' });
    res.json({ name: rows[0].name, code, gueltig_minuten: CODE_MINUTEN });
  } catch (err) { next(err); }
});

router.delete('/stationen/:id', authenticate, requireStaff, async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM signatur_stationen WHERE id=$1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Station nicht gefunden.' });
    res.json({ message: 'Station entfernt.' });
  } catch (err) { next(err); }
});

// Dokument an eine Station schicken. Offene Auftraege derselben Station werden dabei
// verworfen — sonst haengt das Geraet an einem alten Vorgang fest.
router.post('/auftraege', authenticate, requireStaff, async (req, res, next) => {
  try {
    const { station_id, titel, kunde_name, inhalt_html } = req.body || {};
    if (!station_id || !titel || !inhalt_html)
      return res.status(400).json({ error: 'Station, Titel und Inhalt sind Pflicht.' });
    const st = (await query('SELECT id, aktiv, gekoppelt_am FROM signatur_stationen WHERE id=$1', [station_id])).rows[0];
    if (!st) return res.status(404).json({ error: 'Station nicht gefunden.' });
    if (!st.aktiv) return res.status(400).json({ error: 'Diese Station ist abgemeldet.' });
    if (!st.gekoppelt_am) return res.status(400).json({ error: 'Diese Station ist noch nicht gekoppelt.', code: 'NICHT_GEKOPPELT' });
    await query("UPDATE signatur_auftraege SET status='abgebrochen', erledigt_am=now() WHERE station_id=$1 AND status='offen'", [station_id]);
    const { rows } = await query(
      `INSERT INTO signatur_auftraege (station_id, titel, kunde_name, inhalt_html, erstellt_von, ablauf_am)
       VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' minutes')::interval) RETURNING id, ablauf_am`,
      [station_id, String(titel).slice(0, 120), kunde_name ? String(kunde_name).slice(0, 120) : null,
       String(inhalt_html), req.user.id, String(AUFTRAG_MINUTEN)]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// Der PC fragt nach, ob unterschrieben wurde. Das Bild geht zurueck an den Admin, der es
// ueber den bestehenden Weg speichert — dort greifen alle vorhandenen Pruefungen.
router.get('/auftraege/:id', authenticate, requireStaff, async (req, res, next) => {
  try {
    await query("UPDATE signatur_auftraege SET status='abgelaufen' WHERE id=$1 AND status='offen' AND ablauf_am < now()", [req.params.id]);
    const { rows } = await query(
      'SELECT id, status, unterschrift, erledigt_am, ablauf_am FROM signatur_auftraege WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Auftrag nicht gefunden.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/auftraege/:id', authenticate, requireStaff, async (req, res, next) => {
  try {
    await query("UPDATE signatur_auftraege SET status='abgebrochen', erledigt_am=now() WHERE id=$1 AND status='offen'", [req.params.id]);
    res.json({ message: 'Zurückgezogen.' });
  } catch (err) { next(err); }
});

module.exports = router;
