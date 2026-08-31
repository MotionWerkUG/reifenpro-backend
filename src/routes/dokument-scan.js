'use strict';
// Upload eines unterschriebenen Dokuments als Scan/Foto.
//
// Ablauf: Der Ausdruck traegt einen QR-Code, der auf /seite?token=... zeigt. Der Kunde
// unterschreibt auf Papier, der Betrieb fotografiert das Blatt mit dem Handy — das Bild
// haengt dadurch automatisch am richtigen Dokument, ohne Anmeldung und ohne Suchen.
//
// Der Token ersetzt die Anmeldung, deshalb ist er eng geschnitten:
//   - genau EIN Dokument, nur Hochladen (er liefert den Dokumentinhalt nicht aus),
//   - Standard 3 Tage, Obergrenze 7 (fest im Code, nicht konfigurierbar),
//   - nach dem ersten erfolgreichen Upload verbraucht,
//   - beim Neuausstellen (Nachdruck) werden die alten Token desselben Dokuments entwertet,
//     damit der QR auf einem weggelegten Ausdruck nicht scharf bleibt,
//   - Zeitpunkt und IP werden protokolliert.
// Die Seite selbst nennt nur die Dokumentart — kein Name, kein Kennzeichen, keine
// Beleg-Nummer: wer den Ausdruck oder den Link findet, soll daraus nichts ueber den
// Kunden lernen.
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query, withTransaction } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { verarbeite } = require('../lib/bildverarbeitung');

// Ausserhalb des Web-Verzeichnisses: ein unterschriebenes Dokument darf nie ueber eine
// ratbare URL erreichbar sein. Ausgeliefert wird es nur von Admin und Kundenportal ueber
// deren authentifizierte Endpunkte (Muster: pdf_pfad der Rechnungen).
const SCAN_DIR = '/home/deploy/projekte/reifenpro/dokument-scans';
const TAGE_STANDARD = 3;
const TAGE_MAX = 7;
const MAX_BYTES = 20 * 1024 * 1024;
const BASIS_URL = 'https://www.schroeder-scholz.de';

// Oeffentliche Endpunkte: knapp halten, aber nicht so knapp, dass ein zweiter Versuch
// nach einem verwackelten Foto scheitert.
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Dateiart aus der Signatur bestimmen, nicht aus dem mitgeschickten Typ: die Angabe im
// Data-URL stammt vom Client und sagt nichts darueber, was wirklich ankommt.
function dateiArt(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { art: 'bild', ext: 'jpg' };
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { art: 'bild', ext: 'jpg' };
  if (buf.toString('latin1', 4, 8) === 'ftyp' && /hei[cf]|mif1|msf1/i.test(buf.toString('latin1', 8, 12))) return { art: 'bild', ext: 'jpg' };
  if (buf.toString('latin1', 0, 5) === '%PDF-') return { art: 'pdf', ext: 'pdf' };
  return null;
}

// Token pruefen: Signatur, Typ, und der jti muss offen und unverfallen in der Tabelle stehen.
// Die Datenbank entscheidet ueber Gueltigkeit — das JWT-Ablaufdatum allein wuerde weder
// "einmalig" noch "beim Nachdruck entwertet" abbilden.
async function tokenPruefen(token) {
  let p;
  try { p = jwt.verify(String(token || ''), process.env.JWT_SECRET); }
  catch (e) { return null; }
  if (!p || p.typ !== 'dok-scan' || !p.jti || !p.did) return null;
  const { rows } = await query(
    `SELECT t.id, t.dokument_id, t.verbraucht_am, t.gueltig_bis, d.typ AS dokument_typ, d.unterschrift_kunde IS NOT NULL AS signiert
       FROM dokument_scan_token t JOIN kunden_dokumente d ON d.id = t.dokument_id
      WHERE t.jti = $1 AND t.dokument_id = $2`, [p.jti, p.did]);
  const t = rows[0];
  if (!t || t.verbraucht_am || new Date(t.gueltig_bis) < new Date()) return null;
  return { jti: p.jti, dokumentId: t.dokument_id, dokumentTyp: t.dokument_typ, signiert: t.signiert };
}

const DOK_LABEL = {
  einlagerungsschein: 'Einlagerungsschein',
  auslagerungsschein: 'Auslagerungsschein',
  einlagerungsvertrag: 'Einlagerungsvertrag',
  datenschutzerklaerung: 'Datenschutzerklärung',
  sonstiges: 'Dokument'
};

// ── Token ausstellen (fuer den QR auf dem Ausdruck) ──
router.post('/token', authenticate, requireStaff, async (req, res, next) => {
  try {
    const dokumentId = String((req.body && req.body.dokument_id) || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dokumentId)) return res.status(400).json({ error: 'Dokument-ID fehlt oder ist ungültig.' });
    const dok = (await query('SELECT id FROM kunden_dokumente WHERE id=$1', [dokumentId])).rows[0];
    if (!dok) return res.status(404).json({ error: 'Dokument nicht gefunden.' });

    let tage = parseInt(req.body && req.body.tage, 10);
    if (!(tage >= 1)) tage = TAGE_STANDARD;
    tage = Math.min(tage, TAGE_MAX);
    const gueltigBis = new Date(Date.now() + tage * 24 * 3600 * 1000);

    // Ein Dokument, ein gueltiger Token: aeltere offene Token entwerten statt loeschen,
    // damit nachvollziehbar bleibt, dass es sie gab. Entwerten und Ausstellen gehoeren in
    // EINE Transaktion mit Sperre — sonst koennen zwei gleichzeitige Anfragen (Doppelklick,
    // zweiter Tab) aneinander vorbeilaufen und beide Token blieben gueltig.
    const jti = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query('SELECT id FROM kunden_dokumente WHERE id=$1 FOR UPDATE', [dokumentId]);
      await client.query('UPDATE dokument_scan_token SET verbraucht_am=NOW() WHERE dokument_id=$1 AND verbraucht_am IS NULL', [dokumentId]);
      await client.query(
        'INSERT INTO dokument_scan_token (dokument_id, jti, erstellt_von, gueltig_bis) VALUES ($1,$2,$3,$4)',
        [dokumentId, jti, req.user.id, gueltigBis]);
    });
    const token = jwt.sign({ typ: 'dok-scan', did: dokumentId, jti: jti }, process.env.JWT_SECRET, { expiresIn: tage + 'd' });
    res.status(201).json({ token: token, url: BASIS_URL + '/api/dokument-scan/seite?token=' + encodeURIComponent(token), gueltig_bis: gueltigBis.toISOString() });
  } catch (e) { next(e); }
});

// ── Upload-Seite fuers Handy (oeffentlich, nur mit Token) ──
function seite(titel, text, formular) {
  return '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><title>' + esc(titel) + '</title><style>' +
    'body{font-family:-apple-system,Arial,sans-serif;background:#f4f5f7;color:#1a1a1a;margin:0;padding:24px 16px}' +
    '.box{background:#fff;border-radius:16px;padding:26px 22px;max-width:440px;margin:0 auto;box-shadow:0 14px 34px rgba(0,0,0,.09);border-top:4px solid #eab308}' +
    'h1{font-size:19px;margin:0 0 10px}p{color:#555;font-size:15px;line-height:1.55}' +
    'label.f{display:block;background:#eab308;color:#171717;border-radius:10px;padding:15px 20px;font-weight:700;text-align:center;margin-top:18px;cursor:pointer}' +
    'input[type=file]{display:none}#st{margin-top:14px;font-size:14px}.ok{color:#1a8f52;font-weight:700}.err{color:#c8402a;font-weight:700}' +
    '</style></head><body><div class="box"><h1>' + esc(titel) + '</h1><p>' + text + '</p>' + (formular || '') + '</div></body></html>';
}

router.get('/seite', limiter, async (req, res, next) => {
  try {
    const t = await tokenPruefen(req.query.token);
    if (!t) {
      return res.status(400).send(seite('Link nicht mehr gültig',
        'Dieser Link ist abgelaufen oder wurde bereits benutzt. Bitte im Betrieb einen neuen Ausdruck erzeugen.'));
    }
    const label = DOK_LABEL[t.dokumentTyp] || 'Dokument';
    // Bewusst ohne Kunden-, Fahrzeug- oder Belegbezug.
    const formular =
      '<label class="f">Unterschriebenes Blatt fotografieren<input type="file" id="f" accept="image/*,application/pdf" capture="environment"></label>' +
      '<div id="st"></div>' +
      '<scr' + 'ipt>' +
      'var tk=' + JSON.stringify(String(req.query.token)) + ';' +
      'document.getElementById("f").addEventListener("change",function(ev){' +
      'var d=ev.target.files&&ev.target.files[0];if(!d)return;' +
      'var st=document.getElementById("st");st.className="";st.textContent="Wird hochgeladen …";' +
      'var r=new FileReader();r.onload=function(e){' +
      'fetch("/api/dokument-scan/upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:tk,data:e.target.result})})' +
      '.then(function(x){return x.json().then(function(j){if(!x.ok)throw new Error(j.error||"Upload fehlgeschlagen.");return j;});})' +
      '.then(function(){st.className="ok";st.textContent="Gespeichert. Das Dokument gilt jetzt als unterschrieben.";document.querySelector("label.f").style.display="none";})' +
      '.catch(function(err){st.className="err";st.textContent=err.message;});};' +
      'r.readAsDataURL(d);});' +
      '</scr' + 'ipt>';
    res.send(seite(label, 'Bitte das unterschriebene Blatt vollständig und gut lesbar fotografieren.', formular));
  } catch (e) { next(e); }
});

// ── Upload (oeffentlich, nur mit Token) ──
// Groesse: das passende express.json-Limit steht in server.js VOR dem globalen Parser —
// ein zweiter Parser hier waere wirkungslos, weil der Body dann schon geparst ist.
router.post('/upload', limiter, async (req, res, next) => {
  try {
    const t = await tokenPruefen(req.body && req.body.token);
    if (!t) return res.status(410).json({ error: 'Dieser Link ist abgelaufen oder wurde bereits benutzt.' });

    const m = /^data:[^;,]*;base64,(.+)$/.exec(String((req.body && req.body.data) || ''));
    if (!m) return res.status(400).json({ error: 'Keine Datei erkannt. Bitte erneut fotografieren.' });
    const roh = Buffer.from(m[1], 'base64');
    if (!roh.length) return res.status(400).json({ error: 'Die Datei ist leer.' });
    if (roh.length > MAX_BYTES) return res.status(413).json({ error: 'Die Datei ist zu groß (max. 20 MB).' });

    const art = dateiArt(roh);
    if (!art) return res.status(400).json({ error: 'Nur Fotos (JPG/PNG/HEIC) oder PDF-Scans sind möglich.' });

    // Fotos begradigen und verkleinern; PDF unveraendert ablegen (sharp kann PDF nicht).
    const daten = art.art === 'bild' ? await verarbeite(roh, 'scan') : roh;

    // Datei zuerst schreiben, dann Verbrauch und Verknuepfung in EINER Transaktion:
    // Der Token darf erst dann verbraucht sein, wenn der Scan wirklich am Dokument haengt.
    // Sonst waere nach einem Fehler der QR tot, das Foto verwaist und der Kunde muesste
    // neu unterschreiben. Schlaegt die Transaktion fehl, raeumen wir die Datei weg und der
    // Link bleibt gueltig.
    if (!fs.existsSync(SCAN_DIR)) fs.mkdirSync(SCAN_DIR, { recursive: true, mode: 0o750 });
    const ziel = path.join(SCAN_DIR, t.dokumentId + '-' + Date.now() + '.' + art.ext);
    fs.writeFileSync(ziel, daten, { mode: 0o640 });
    // Der Dienst laeuft als root, die Projektdateien gehoeren deploy. Eigentuemer vom
    // Ablageordner uebernehmen, damit Sicherung und Aufraeumen ohne sudo moeglich bleiben.
    try { const v = fs.statSync(SCAN_DIR); fs.chownSync(ziel, v.uid, v.gid); } catch (e) { /* nicht kritisch */ }

    // req.ip statt X-Forwarded-For selbst zu lesen: nginx haengt den Header nur an einen
    // vom Client mitgeschickten Wert an, der erste Eintrag waere also frei erfindbar.
    // Mit 'trust proxy' liefert req.ip die tatsaechliche Gegenstelle.
    const ip = req.ip || null;
    let ok = false;
    try {
      ok = await withTransaction(async (client) => {
        // Atomar: wer den Token als Erster verbraucht, gewinnt. Der zweite bekommt 410
        // statt einer stillen Ueberschreibung.
        const verbraucht = await client.query(
          'UPDATE dokument_scan_token SET verbraucht_am=NOW(), ip=$2 WHERE jti=$1 AND verbraucht_am IS NULL RETURNING dokument_id',
          [t.jti, ip]);
        if (!verbraucht.rows.length) return false;
        // scan_pfad und unterschrift_weg MUESSEN in einem Update stehen: die Aufbewahrungs-
        // sperre greift, sobald scan_pfad gesetzt ist, und wuerde einen zweiten Schritt
        // blockieren (so von der Admin-Session gebaut und gewollt).
        await client.query(
          `UPDATE kunden_dokumente
              SET scan_pfad=$1, unterschrift_weg='scan', unterschrift_datum=COALESCE(unterschrift_datum, NOW())
            WHERE id=$2`, [ziel, t.dokumentId]);
        return true;
      });
    } catch (fehler) {
      try { fs.unlinkSync(ziel); } catch (e) { /* Datei evtl. nie entstanden */ }
      throw fehler;
    }
    if (!ok) {
      try { fs.unlinkSync(ziel); } catch (e) { /* egal */ }
      return res.status(410).json({ error: 'Dieser Link wurde soeben schon benutzt.' });
    }

    res.json({ message: 'Scan gespeichert.', dokument_id: t.dokumentId, unterschrift_weg: 'scan' });
  } catch (e) { next(e); }
});

module.exports = router;
