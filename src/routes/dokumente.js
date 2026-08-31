const router = require('express').Router({ mergeParams: true });
const fs = require('fs');
const path = require('path');
const { query } = require('../db/index');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const { pruefeAnschrift } = require('../lib/kundendaten');

router.use(authenticate, requireStaff);

// aktuelle Soll-Version je Dokumenttyp (fuer Gueltigkeitspruefung)
async function sollVersion(typ, e) {
  e = e || (await query('SELECT dok_ds_version, dok_vertrag_version FROM einstellungen LIMIT 1')).rows[0] || {};
  if (typ === 'datenschutzerklaerung') return e.dok_ds_version || null;
  if (typ === 'einlagerungsvertrag') return e.dok_vertrag_version || null;
  return null; // Scheine: kein Versions-/Ablaufkonzept
}
function istGueltig(d, sollVer) {
  if (!d.unterschrieben && !d.unterschrift_kunde) return false;
  if (d.typ !== 'datenschutzerklaerung' && d.typ !== 'einlagerungsvertrag') return true; // Scheine laufen nicht ab
  const today = new Date().toISOString().substring(0, 10);
  const zeitOk = !d.gueltig_bis || String(d.gueltig_bis).substring(0, 10) >= today;
  const verOk = (d.version || null) === (sollVer || null);
  return zeitOk && verOk;
}

router.get('/', async (req, res, next) => {
  try {
    const e = (await query('SELECT dok_ds_version, dok_vertrag_version FROM einstellungen LIMIT 1')).rows[0] || {};
    const { rows } = await query(
      `SELECT id,typ,titel,erstellt_am,einlagerung_id,gueltig_bis,version,
              unterschrift_datum,
              CASE WHEN unterschrift_kunde IS NOT NULL OR scan_pfad IS NOT NULL THEN true ELSE false END AS unterschrieben,
              (scan_pfad IS NOT NULL) AS hat_scan, unterschrift_weg
       FROM kunden_dokumente WHERE kunden_id=$1 ORDER BY erstellt_am DESC`,
      [req.params.kundenId]
    );
    rows.forEach((r) => { r.gueltig = istGueltig(r, e[r.typ === 'datenschutzerklaerung' ? 'dok_ds_version' : 'dok_vertrag_version']); });
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:did', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, kunden_id, einlagerung_id, typ, titel, inhalt_html, unterschrift_kunde,
              unterschrift_datum, unterschrift_weg, (scan_pfad IS NOT NULL) AS hat_scan,
              version, gueltig_bis, erstellt_am, erstellt_von
         FROM kunden_dokumente WHERE id=$1 AND kunden_id=$2`,
      [req.params.did, req.params.kundenId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { typ, titel, inhalt_html, einlagerung_id,
            unterschrift_kunde, unterschrift_datum } = req.body;
    if (!typ || !inhalt_html)
      return res.status(400).json({ error: 'typ und inhalt_html sind Pflicht.' });
    // Ohne Whitelist landete ein unbekannter typ erst im Check-Constraint der Datenbank und
    // kam als roher 500er zurueck. Der Aufrufer soll stattdessen sehen, was erlaubt ist.
    const ERLAUBTE_TYPEN = ['datenschutzerklaerung', 'einlagerungsvertrag', 'einlagerungsschein',
                            'auslagerungsschein', 'scan', 'sonstiges'];
    if (!ERLAUBTE_TYPEN.includes(typ))
      return res.status(400).json({ error: 'Unbekannte Dokumentart: ' + typ, code: 'TYP_UNBEKANNT' });
    // Der Einlagerungsvertrag ist der Punkt, an dem eine Leistung entsteht und die spaeter
    // abgerechnet wird. Ohne vollstaendige Anschrift ist er als Beleg unbrauchbar (die Rechnung
    // braucht sie nach § 14 UStG). Bisher wurde die Anschrift aus dem Stamm gezogen, aber nie
    // geprueft — ein Vertrag ohne Anschrift war moeglich.
    if (typ === 'einlagerungsvertrag') {
      const k = (await query('SELECT vorname, nachname, strasse, plz, ort, land FROM kunden WHERE id=$1', [req.params.kundenId])).rows[0];
      if (!k) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
      // Vorhandensein ist Pflicht. Eine fehlende Hausnummer ist dagegen nur eine Rueckfrage wert —
      // sie am Vertrag zu blockieren wuerde den Kunden am Tresen stehen lassen, obwohl seine
      // Adresse real so lautet.
      const fehlt = pruefeAnschrift({ strasse: k.strasse, plz: k.plz, ort: k.ort, land: k.land }, true);
      if (fehlt && !fehlt.weich) return res.status(400).json({
        error: 'Für den Einlagerungsvertrag fehlt die Anschrift von ' + [k.vorname, k.nachname].filter(Boolean).join(' ') + '. ' + fehlt.fehler,
        code: fehlt.code
      });
    }
    const e = (await query('SELECT dok_ds_version, dok_vertrag_version, dok_ds_gueltig_monate FROM einstellungen LIMIT 1')).rows[0] || {};
    const version = await sollVersion(typ, e);
    // Duplikat-Sperre: bei Datenschutz/Vertrag kein zweites gueltiges, unterschriebenes Dokument anlegen
    if ((typ === 'datenschutzerklaerung' || typ === 'einlagerungsvertrag') && unterschrift_kunde) {
      const vorhanden = (await query(
        `SELECT id,typ,gueltig_bis,version, (unterschrift_kunde IS NOT NULL OR scan_pfad IS NOT NULL) AS unterschrieben
         FROM kunden_dokumente WHERE kunden_id=$1 AND typ=$2 AND (unterschrift_kunde IS NOT NULL OR scan_pfad IS NOT NULL)
         ORDER BY erstellt_am DESC LIMIT 1`, [req.params.kundenId, typ])).rows[0];
      if (vorhanden && istGueltig(vorhanden, version)) {
        return res.status(200).json(Object.assign({ bereits_vorhanden: true }, vorhanden));
      }
    }
    // Gueltig-bis: Datenschutz zeitlich begrenzt (Monate aus Einstellungen), Vertrag/Scheine unbegrenzt
    let gueltigBis = null;
    if (typ === 'datenschutzerklaerung') {
      const mon = parseInt(e.dok_ds_gueltig_monate) || 24;
      const d = new Date(); d.setMonth(d.getMonth() + mon); gueltigBis = d.toISOString().substring(0, 10);
    }
    const { rows } = await query(
      `INSERT INTO kunden_dokumente
         (kunden_id,typ,titel,inhalt_html,einlagerung_id,
          unterschrift_kunde,unterschrift_datum,version,gueltig_bis,erstellt_von)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.kundenId, typ, titel||typ, inhalt_html,
       einlagerung_id||null,
       unterschrift_kunde||null,
       unterschrift_datum||null,
       version, gueltigBis,
       req.user.id]
    );
    await auditLog({ userId: req.user.id, aktion: 'dokument.erstellt',
      tabelle: 'kunden_dokumente', datensatzId: rows[0].id, req });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:did/unterschrift', async (req, res, next) => {
  try {
    const { unterschrift_kunde } = req.body;
    if (!unterschrift_kunde)
      return res.status(400).json({ error: 'Unterschrift fehlt.' });
    const cur = (await query('SELECT typ FROM kunden_dokumente WHERE id=$1 AND kunden_id=$2', [req.params.did, req.params.kundenId])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Nicht gefunden.' });
    const e = (await query('SELECT dok_ds_version, dok_vertrag_version, dok_ds_gueltig_monate FROM einstellungen LIMIT 1')).rows[0] || {};
    const version = await sollVersion(cur.typ, e);
    let gueltigBis = null;
    if (cur.typ === 'datenschutzerklaerung') { const mon = parseInt(e.dok_ds_gueltig_monate) || 24; const d = new Date(); d.setMonth(d.getMonth() + mon); gueltigBis = d.toISOString().substring(0, 10); }
    // Eine vorhandene Unterschrift wird NIE ueberschrieben: sie ist der Nachweis, dass der Kunde
    // genau diesen Stand bestaetigt hat. Aendert sich etwas, gehoert das in ein NEUES Dokument.
    const { rows } = await query(
      `UPDATE kunden_dokumente
       SET unterschrift_kunde=$1, unterschrift_datum=NOW(), version=$4, gueltig_bis=$5
       WHERE id=$2 AND kunden_id=$3 AND unterschrift_kunde IS NULL AND scan_pfad IS NULL RETURNING *`,
      [unterschrift_kunde, req.params.did, req.params.kundenId, version, gueltigBis]
    );
    if (!rows.length) {
      const da = (await query('SELECT (unterschrift_kunde IS NOT NULL OR scan_pfad IS NOT NULL) AS unterschrieben FROM kunden_dokumente WHERE id=$1 AND kunden_id=$2', [req.params.did, req.params.kundenId])).rows[0];
      if (!da) return res.status(404).json({ error: 'Nicht gefunden.' });
      return res.status(409).json({
        error: 'Dieses Dokument ist bereits unterschrieben. Eine Unterschrift lässt sich nicht ersetzen — bitte ein neues Dokument anlegen.',
        code: 'BEREITS_UNTERSCHRIEBEN'
      });
    }
    await auditLog({ userId: req.user.id, aktion: 'dokument.unterschrieben',
      tabelle: 'kunden_dokumente', datensatzId: req.params.did, req });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// Loeschen ist Admin-Sache und nur solange moeglich, wie das Dokument NICHT unterschrieben ist.
// Ein unterschriebener Einlagerungsvertrag oder -schein ist ein aufbewahrungspflichtiger Beleg
// (§ 257 HGB, § 147 AO). Vorher konnte jeder Mitarbeiter ihn spurlos loeschen — und damit
// nebenbei die Loeschsperre der zugehoerigen Einlagerung aushebeln.
router.delete('/:did', requireAdmin, async (req, res, next) => {
  try {
    const d = (await query(
      'SELECT id, typ, titel, (unterschrift_kunde IS NOT NULL OR scan_pfad IS NOT NULL) AS unterschrieben FROM kunden_dokumente WHERE id=$1 AND kunden_id=$2',
      [req.params.did, req.params.kundenId])).rows[0];
    if (!d) return res.status(404).json({ error: 'Nicht gefunden.' });
    if (d.unterschrieben) return res.status(409).json({
      error: 'Unterschriebene Dokumente dürfen nicht gelöscht werden (Aufbewahrungspflicht). Bei einem Fehler bitte ein neues Dokument anlegen.',
      code: 'UNTERSCHRIEBEN_AUFBEWAHRUNGSPFLICHT'
    });
    const { rows } = await query(
      'DELETE FROM kunden_dokumente WHERE id=$1 AND kunden_id=$2 AND unterschrift_kunde IS NULL AND scan_pfad IS NULL RETURNING id',
      [req.params.did, req.params.kundenId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    await auditLog({ userId: req.user.id, aktion: 'dokument.geloescht',
      tabelle: 'kunden_dokumente', datensatzId: req.params.did,
      alteWerte: { typ: d.typ, titel: d.titel }, req });
    res.json({ message: 'Gelöscht.' });
  } catch (err) { next(err); }
});

// ── GET /:did/scan ── das eingescannte, unterschriebene Blatt ausliefern
// Ohne diesen Weg waere der Scan eine Sackgasse: Die Unterschrift laege als Datei auf dem
// Server, waere aber nirgends einsehbar — der Beleg damit wertlos. Ablage liegt bewusst
// ausserhalb des Web-Verzeichnisses, deshalb ist das hier die einzige Tuer dorthin.
const SCAN_BASIS = path.resolve('/home/deploy/projekte/reifenpro/dokument-scans');
const SCAN_TYPEN = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf' };

router.get('/:did/scan', async (req, res, next) => {
  try {
    const d = (await query(
      'SELECT scan_pfad, typ FROM kunden_dokumente WHERE id=$1 AND kunden_id=$2',
      [req.params.did, req.params.kundenId])).rows[0];
    if (!d) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    if (!d.scan_pfad) return res.status(404).json({ error: 'Zu diesem Dokument gibt es keinen Scan.' });
    // Der Pfad kommt zwar aus der eigenen Datenbank, wird aber trotzdem geprueft: eine
    // fehlerhaft geschriebene Zeile duerfte sonst jede Datei des Servers ausliefern.
    const datei = path.resolve(d.scan_pfad);
    if (datei !== SCAN_BASIS && !datei.startsWith(SCAN_BASIS + path.sep))
      return res.status(400).json({ error: 'Ungültiger Ablageort.' });
    const typ = SCAN_TYPEN[path.extname(datei).toLowerCase()];
    if (!typ) return res.status(400).json({ error: 'Unbekannte Dateiart.' });
    let stat;
    try { stat = fs.statSync(datei); } catch (x) { stat = null; }
    if (!stat || !stat.isFile()) return res.status(404).json({ error: 'Die Scan-Datei fehlt auf dem Server.' });
    res.setHeader('Content-Type', typ);
    res.setHeader('Content-Disposition', 'inline; filename="' + d.typ + path.extname(datei).toLowerCase() + '"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Ohne Fehlerbehandlung wuerde ein Lesefehler (Datei verschwindet zwischen Pruefung und
    // Auslieferung, Rechte geaendert) als unbehandeltes Ereignis den ganzen Dienst beenden.
    const strom = fs.createReadStream(datei);
    strom.on('error', function (fehler) { if (!res.headersSent) next(fehler); else res.destroy(); });
    strom.pipe(res);
  } catch (e) { next(e); }
});

// ── POST /:did/scan ── unterschriebenes Blatt einscannen und an DIESES Dokument haengen
// Frueher gab es nur "Scan hochladen" am Kunden: das legte ein freistehendes Dokument vom
// Typ 'scan' an, ohne Bezug zum Vorgang. Ein so abgelegter, tatsaechlich unterschriebener
// Schein galt dem System als nicht unterschrieben — die Faelligkeitsmeldung blieb stehen und
// die Aufbewahrungssperre griff nicht, der Beleg war jederzeit loeschbar.
const SCAN_MAX = 15 * 1024 * 1024;
const SCAN_SIGNATUREN = [
  { endung: '.pdf', bytes: [0x25, 0x50, 0x44, 0x46] },                    // %PDF
  { endung: '.png', bytes: [0x89, 0x50, 0x4e, 0x47] },                    // PNG
  { endung: '.jpg', bytes: [0xff, 0xd8, 0xff] }                           // JPEG
];

router.post('/:did/scan', async (req, res, next) => {
  try {
    const { data } = req.body || {};
    if (!data || typeof data !== 'string')
      return res.status(400).json({ error: 'Keine Datei empfangen.' });
    const komma = data.indexOf(',');
    const roh = Buffer.from(komma >= 0 ? data.slice(komma + 1) : data, 'base64');
    if (!roh.length) return res.status(400).json({ error: 'Die Datei ist leer.' });
    if (roh.length > SCAN_MAX)
      return res.status(413).json({ error: 'Die Datei ist zu groß (höchstens 15 MB).' });
    // Die Dateiart kommt aus dem Inhalt, nicht aus dem Namen oder dem Data-URL: beides
    // koennte falsch sein, und der Ausliefer-Endpunkt entscheidet nach der Endung.
    const art = SCAN_SIGNATUREN.find(function (t) {
      return t.bytes.every(function (b, i) { return roh[i] === b; });
    });
    if (!art) return res.status(400).json({ error: 'Nur PDF, JPG oder PNG sind zulässig.' });

    const d = (await query(
      `SELECT id, typ, (unterschrift_kunde IS NOT NULL) AS am_bildschirm, scan_pfad
         FROM kunden_dokumente WHERE id=$1 AND kunden_id=$2`,
      [req.params.did, req.params.kundenId])).rows[0];
    if (!d) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
    if (d.am_bildschirm || d.scan_pfad)
      return res.status(409).json({
        error: 'Dieses Dokument ist bereits unterschrieben. Bei einem Fehler bitte ein neues anlegen.',
        code: 'BEREITS_UNTERSCHRIEBEN' });

    fs.mkdirSync(SCAN_BASIS, { recursive: true, mode: 0o750 });
    const datei = path.join(SCAN_BASIS, d.id + '-' + Date.now() + art.endung);
    fs.writeFileSync(datei, roh, { mode: 0o640 });
    // Der Dienst laeuft als root, die Geschaeftsdaten gehoeren aber deploy. Eigentuemer vom
    // Ablageordner uebernehmen, damit Sicherung und Aufraeumen als deploy funktionieren.
    // Bewusst unkritisch: ein Rechtefehler darf den Upload nicht scheitern lassen.
    try { const o = fs.statSync(SCAN_BASIS); fs.chownSync(datei, o.uid, o.gid); } catch (x) {}
    try {
      // Beides in EINEM Update: die Aufbewahrungssperre greift, sobald scan_pfad steht —
      // ein zweiter Schritt fuer unterschrift_weg wuerde von ihr abgewiesen.
      await query(
        `UPDATE kunden_dokumente SET scan_pfad=$1, unterschrift_weg='scan', unterschrift_datum=NOW()
          WHERE id=$2 AND kunden_id=$3`,
        [datei, req.params.did, req.params.kundenId]);
    } catch (fehler) {
      fs.unlinkSync(datei);
      throw fehler;
    }
    await auditLog({ userId: req.user.id, aktion: 'dokument.scan_hochgeladen',
      tabelle: 'kunden_dokumente', datensatzId: d.id,
      neueWerte: { typ: d.typ, unterschrift_weg: 'scan', groesse: roh.length }, req });
    res.json({ message: 'Scan gespeichert. Das Dokument gilt jetzt als unterschrieben.',
      unterschrift_weg: 'scan' });
  } catch (e) { next(e); }
});

module.exports = router;
