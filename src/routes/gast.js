'use strict';
// Oeffentliche Gaeste-Terminbuchung (ohne Kundenkonto) – mehrstufiger Assistent auf /termin/.
// Liegt auf dem Server unter src/routes/gast.js. Gemountet (oeffentlich) als /api/gast.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { query, withTransaction } = require('../db/index');
const { portalMailHtml } = require('../lib/mail-template');
const { resolvePreis } = require('../lib/preis');
const oeffnung = require('../lib/oeffnung');

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
const FZ_TYPEN = ['PKW', 'SUV', 'Transporter', 'Motorrad', 'Sonstiges'];

// Baut die Kalkulationspositionen: je Leistung Grundpreis + (getrennt) Fahrzeug-Zuschlag.
// typ = gewaehlter Fahrzeugtyp (z.B. SUV), zoll = Zollgroesse (optional).
async function baueKalkulation(mainIds, zusatzIds, typ, zoll) {
  const ids = mainIds.concat(zusatzIds);
  const leer = { positionen: [], netto: 0, mwst: 0, brutto: 0, dauer: 30, gewaehlt: [] };
  if (!ids.length) return leer;
  const arts = (await query('SELECT * FROM artikel WHERE id = ANY($1::uuid[]) AND aktiv IS NOT false', [ids])).rows;
  const vars = (await query('SELECT * FROM artikel_preise WHERE artikel_id = ANY($1::uuid[])', [ids])).rows;
  const byArt = {}; arts.forEach(function (a) { byArt[a.id] = a; });
  const varsByArt = {}; vars.forEach(function (v) { (varsByArt[v.artikel_id] = varsByArt[v.artikel_id] || []).push(v); });
  const order = mainIds.map(function (id) { return { id: id, rolle: 'haupt' }; })
    .concat(zusatzIds.map(function (id) { return { id: id, rolle: 'zusatz' }; }));
  const positionen = []; let netto = 0, mwst = 0, dauer = 0; const gewaehlt = [];
  order.forEach(function (it) {
    const a = byArt[it.id]; if (!a) return;
    const variants = varsByArt[a.id] || [];
    const basis = resolvePreis(a, variants, null, zoll);          // ohne Fahrzeugtyp-Zuschlag
    const eff = resolvePreis(a, variants, typ || null, zoll);     // mit gewaehltem Typ
    const effPreis = Number(eff.preis) || 0;
    const grund = round2(Math.min(Number(basis.preis) || 0, effPreis));
    const zuschlag = round2(effPreis - grund);
    const satz = Number(eff.mwst_satz != null ? eff.mwst_satz : 19);
    const zeilenNetto = round2(effPreis);
    netto = round2(netto + zeilenNetto);
    mwst = round2(mwst + zeilenNetto * satz / 100);
    dauer += (eff.dauer_minuten != null ? eff.dauer_minuten : (a.dauer_minuten || 30));
    gewaehlt.push(a.name);
    positionen.push({
      artikel_id: a.id, bezeichnung: a.name, rolle: it.rolle,
      grundpreis_netto: grund, zuschlag_netto: zuschlag,
      fahrzeugtyp: zuschlag > 0 ? (typ || null) : null,
      mwst_satz: satz, zeilen_netto: zeilenNetto
    });
  });
  return { positionen: positionen, netto: round2(netto), mwst: round2(mwst), brutto: round2(netto + mwst), dauer: Math.min(dauer || 30, 480), gewaehlt: gewaehlt };
}

const limiter = rateLimit({ windowMs: 900000, max: 30, message: { error: 'Zu viele Anfragen. Bitte später erneut versuchen.' } });
const bookLimiter = rateLimit({ windowMs: 900000, max: 8, message: { error: 'Zu viele Buchungen. Bitte später erneut versuchen.' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function zeitZuMin(z) { if (!z) return 0; const s = String(z).substring(0, 5); const p = s.split(':').map(Number); return p[0] * 60 + (p[1] || 0); }
function minZuZeit(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }

// Oeffnungszeiten fuer ein Datum (ohne Leistung)
async function oeffnungFuerTag(datum) {
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0];
  if (!einst) return { fehler: 'Einstellungen fehlen' };
  const urlaub = await query('SELECT id FROM betriebsurlaub WHERE von_datum <= $1 AND bis_datum >= $1', [datum]);
  if (urlaub.rows.length) return { grund: 'Betriebsurlaub', einst };
  // Neues Modell: besondere Tage (Feiertag/Urlaub) ueberschreiben die regulaere Woche; 1-2 Spannen/Tag.
  const off = await oeffnung.oeffnungFuerTag(datum);
  if (off.geschlossen) {
    const bt = (await query('SELECT bezeichnung FROM besondere_tage WHERE datum=$1 AND geschlossen=true', [datum])).rows[0];
    return { grund: (bt && bt.bezeichnung) ? bt.bezeichnung : 'Geschlossen', einst };
  }
  return { einst, spannen: off.spannen };
}

async function freieSlots(datum, dauer) {
  const o = await oeffnungFuerTag(datum);
  if (o.fehler) return { error: o.fehler };
  if (o.grund) return { slots: [], grund: o.grund };
  const einst = o.einst;
  const maxParallel = einst.max_parallele_termine || 1;
  const gebuchte = (await query("SELECT uhrzeit_von, uhrzeit_bis FROM termine WHERE datum=$1 AND status NOT IN ('storniert','abgesagt')", [datum])).rows;
  const slots = [];
  // Ueber jede Oeffnungsspanne (Vormittag/Nachmittag) einzeln -> die Mittagspause zwischen den Spannen bleibt frei.
  for (const sp of o.spannen) {
    const vonMin = zeitZuMin(sp[0]), bisMin = zeitZuMin(sp[1]);
    for (let start = vonMin; start + dauer <= bisMin; start += 15) {
      const ende = start + dauer;
      const ueber = gebuchte.filter(t => start < zeitZuMin(t.uhrzeit_bis) && ende > zeitZuMin(t.uhrzeit_von)).length;
      if (ueber < maxParallel) slots.push({ von: minZuZeit(start), bis: minZuZeit(ende) });
    }
  }
  return { slots, dauer };
}

// Konfigurierte Buchungs-Leistungen (Haupt + Zusatz) inkl. Bild/Text/Dauer
router.get('/leistungen', limiter, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT bl.artikel_id, bl.rolle, COALESCE(NULLIF(bl.titel,''), a.name) AS titel,
              bl.beschreibung, bl.bild_url, bl.sortierung, a.dauer_minuten, a.preis, a.mwst_satz
       FROM buchung_leistungen bl JOIN artikel a ON a.id = bl.artikel_id
       WHERE bl.aktiv = true AND a.aktiv IS NOT false
       ORDER BY bl.sortierung, titel`);
    // "ab"-Preis je Leistung = niedrigster moeglicher Nettopreis (Basis bzw. guenstigste Variante)
    const ids = rows.map(r => r.artikel_id);
    const vars = ids.length ? (await query('SELECT artikel_id, preis FROM artikel_preise WHERE artikel_id = ANY($1::uuid[])', [ids])).rows : [];
    const minByArt = {};
    vars.forEach(v => { const p = Number(v.preis); if (minByArt[v.artikel_id] == null || p < minByArt[v.artikel_id]) minByArt[v.artikel_id] = p; });
    rows.forEach(r => {
      const basis = r.preis != null ? Number(r.preis) : null;
      let ab = basis;
      if (minByArt[r.artikel_id] != null) ab = (ab == null) ? minByArt[r.artikel_id] : Math.min(ab, minByArt[r.artikel_id]);
      const satz = Number(r.mwst_satz != null ? r.mwst_satz : 19);
      r.ab_netto = ab != null ? round2(ab) : null;
      r.ab_brutto = ab != null ? round2(ab * (1 + satz / 100)) : null;
    });
    res.json({
      haupt: rows.filter(r => r.rolle === 'haupt'),
      zusatz: rows.filter(r => r.rolle === 'zusatz')
    });
  } catch (e) { next(e); }
});

// Live-Kalkulation: gewaehlte Leistungen + Fahrzeugtyp/Zoll -> itemisierte Positionen (Grundpreis + Zuschlag)
router.get('/kalkulation', limiter, async (req, res, next) => {
  try {
    const split = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
    const mainIds = split(req.query.main_ids || req.query.artikel_id);
    const zusatzIds = split(req.query.zusatz_ids);
    if (!mainIds.length) return res.json({ positionen: [], netto: 0, mwst: 0, brutto: 0, dauer: 0, gewaehlt: [] });
    const k = await baueKalkulation(mainIds, zusatzIds, req.query.typ || null, req.query.zoll || null);
    res.json(k);
  } catch (e) { next(e); }
});

// Freie Slots fuer ein Datum und eine Gesamtdauer (Minuten)
router.get('/slots', limiter, async (req, res, next) => {
  try {
    const { datum } = req.query;
    if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ error: 'Gültiges datum (YYYY-MM-DD) erforderlich' });
    let dauer = parseInt(req.query.dauer);
    if (!(dauer > 0)) {
      if (req.query.artikel_id) {
        const a = (await query('SELECT dauer_minuten FROM artikel WHERE id=$1', [req.query.artikel_id])).rows[0];
        dauer = (a && a.dauer_minuten) || 30;
      } else dauer = 30;
    }
    dauer = Math.min(dauer, 480);
    const r = await freieSlots(datum, dauer);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (e) { next(e); }
});

// Double-Opt-in: Bestaetigung der Werbe-/Saison-Einwilligung per Link aus der Mail
router.get('/einwilligung/bestaetigen', async (req, res, next) => {
  try {
    const seite = (titel, text) => '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + titel + ' — Schröder &amp; Scholz</title>' +
      '<style>body{font-family:-apple-system,Arial,sans-serif;background:#f4f5f7;color:#1a1a1a;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}.box{background:#fff;border-radius:16px;padding:34px 30px;max-width:460px;text-align:center;box-shadow:0 14px 34px rgba(0,0,0,.1);border-top:4px solid #eab308}h1{font-size:20px;color:#171717;margin:0 0 10px}p{color:#555;font-size:15px}a{color:#171717}</style></head><body><div class="box"><h1>' + titel + '</h1><p>' + text + '</p><p style="margin-top:18px"><a href="https://www.schroeder-scholz.de/">Zur Startseite</a></p></div></body></html>';
    const token = req.query.token;
    if (!token) return res.status(400).send(seite('Link unvollständig', 'Der Bestätigungslink ist nicht vollständig.'));
    const k = (await query('SELECT id FROM kunden WHERE einwilligung_token=$1 AND einwilligung_token_ablauf > NOW()', [token])).rows[0];
    if (!k) return res.status(400).send(seite('Link ungültig oder abgelaufen', 'Dieser Bestätigungslink ist nicht mehr gültig. Bitte fordern Sie bei Bedarf einen neuen an.'));
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    await query("UPDATE kunden SET einwilligung_saison_erinnerung=true, einwilligung_saison_bestaetigt=true, einwilligung_saison_bestaetigt_am=NOW(), einwilligung_ip=$2, einwilligung_token=NULL, einwilligung_token_ablauf=NULL WHERE id=$1", [k.id, ip]);
    res.send(seite('Vielen Dank!', 'Ihre Einwilligung für saisonale Erinnerungen ist bestätigt. Sie können sie jederzeit widerrufen.'));
  } catch (e) { next(e); }
});

// 1-Klick-Abmeldung aus Werbe-Mails (Saison). Token = signiertes JWT {id, typ:'unsub'} aus der Mail.
router.get('/einwilligung/abmelden', async (req, res, next) => {
  try {
    const seite = (titel, text) => '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + titel + ' — Schröder &amp; Scholz</title>' +
      '<style>body{font-family:-apple-system,Arial,sans-serif;background:#f4f5f7;color:#1a1a1a;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}.box{background:#fff;border-radius:16px;padding:34px 30px;max-width:460px;text-align:center;box-shadow:0 14px 34px rgba(0,0,0,.1);border-top:4px solid #eab308}h1{font-size:20px;color:#171717;margin:0 0 10px}p{color:#555;font-size:15px}a{color:#171717}</style></head><body><div class="box"><h1>' + titel + '</h1><p>' + text + '</p><p style="margin-top:18px"><a href="https://www.schroeder-scholz.de/">Zur Startseite</a></p></div></body></html>';
    let payload;
    try { payload = jwt.verify(req.query.token || '', process.env.JWT_SECRET); } catch (e) { payload = null; }
    if (!payload || payload.typ !== 'unsub' || !payload.id) {
      return res.status(400).send(seite('Link ungültig', 'Dieser Abmeldelink ist ungültig oder abgelaufen.'));
    }
    await query('UPDATE kunden SET einwilligung_saison_erinnerung=false, einwilligung_saison_bestaetigt=false, einwilligung_token=NULL, einwilligung_token_ablauf=NULL, widerruf_datum=NOW(), geaendert_am=NOW() WHERE id=$1', [payload.id]);
    res.send(seite('Abgemeldet', 'Sie erhalten keine Saison-Erinnerungen mehr. Falls Sie das später ändern möchten, können Sie die Einwilligung in Ihrem Kundenportal erneut erteilen.'));
  } catch (e) { next(e); }
});

// Termin buchen (Gast) – mehrere Hauptleistungen + Zusatzleistungen, Fahrzeugtyp/Zoll, sofort bestaetigt
router.post('/termin', bookLimiter, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ message: 'ok' }); // Honeypot
    const splitList = (s) => Array.isArray(s) ? s.filter(Boolean) : String(s || '').split(',').map(x => x.trim()).filter(Boolean);
    let mainIds = splitList(b.main_ids);
    if (!mainIds.length && (b.main_artikel_id || b.artikel_id)) mainIds = [b.main_artikel_id || b.artikel_id];
    const zusatzIds = splitList(b.zusatz_ids);
    const { anrede, vorname, nachname, telefon, email, strasse, plz, ort, fahrzeugtyp, zoll, kennzeichen, datum, uhrzeit_von, datenschutz, werbung } = b;
    if (!vorname || !nachname || !telefon || !email || !kennzeichen || !strasse || !plz || !ort || !datum || !uhrzeit_von || !mainIds.length)
      return res.status(400).json({ error: 'Bitte alle Pflichtfelder ausfüllen (inkl. Anschrift und mindestens eine Leistung).' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !/^\d{2}:\d{2}/.test(uhrzeit_von)) return res.status(400).json({ error: 'Ungültiges Datum oder Uhrzeit.' });
    if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
    if (datenschutz !== true) return res.status(400).json({ error: 'Bitte bestätigen Sie die Kenntnisnahme der Datenschutzerklärung.' });
    const fzt = FZ_TYPEN.includes(fahrzeugtyp) ? fahrzeugtyp : null;

    const kalk = await baueKalkulation(mainIds, zusatzIds, fzt, zoll || null);
    if (!kalk.positionen.length) return res.status(404).json({ error: 'Leistung nicht gefunden.' });
    const dauer = kalk.dauer;

    const o = await oeffnungFuerTag(datum);
    if (o.fehler) return res.status(400).json({ error: o.fehler });
    if (o.grund) return res.status(409).json({ error: 'An diesem Tag ist keine Buchung möglich (' + o.grund + ').' });
    // Datum/Uhrzeit serverseitig validieren (sonst per direktem Request umgehbar)
    const heuteStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    if (datum < heuteStr) return res.status(400).json({ error: 'Das gewählte Datum liegt in der Vergangenheit.' });
    const startMin = zeitZuMin(uhrzeit_von), endeMin = startMin + dauer;
    // Muss vollstaendig in eine Oeffnungsspanne fallen (deckt Oeffnungszeiten UND Mittagspause ab).
    const imFenster = (o.spannen || []).some(sp => startMin >= zeitZuMin(sp[0]) && endeMin <= zeitZuMin(sp[1]));
    if (!imFenster) return res.status(400).json({ error: 'Die gewählte Uhrzeit liegt außerhalb der Öffnungszeiten.' });
    if (datum === heuteStr) {
      const jetztMin = zeitZuMin(new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }));
      if (startMin <= jetztMin) return res.status(400).json({ error: 'Die gewählte Uhrzeit liegt in der Vergangenheit.' });
    }
    const uhrzeit_bis = minZuZeit(zeitZuMin(uhrzeit_von) + dauer);
    const maxParallel = o.einst.max_parallele_termine || 1;

    // Freitext von unauthentifizierten Gaesten entschaerfen: Winkelklammern raus -> keine gespeicherte XSS im Admin
    const noTag = (s) => String(s == null ? '' : s).replace(/[<>]/g, '');
    const vn = noTag(vorname).slice(0, 80), nn = noTag(nachname).slice(0, 80);
    const nm = (vn + ' ' + nn).trim().slice(0, 160);
    const tel = noTag(telefon).slice(0, 60), em = String(email).slice(0, 160), kz = noTag(kennzeichen).slice(0, 20);
    const an = ['Herr', 'Frau', 'Divers', 'Firma'].includes(anrede) ? anrede : null;
    const str = noTag(strasse).slice(0, 160), pz = noTag(plz).slice(0, 12), or = noTag(ort).slice(0, 120);
    const mainArtId = mainIds[0];
    const hauptNamen = kalk.positionen.filter(p => p.rolle === 'haupt').map(p => p.bezeichnung);
    const zusatzN = kalk.positionen.filter(p => p.rolle === 'zusatz').length;
    const terminTyp = (hauptNamen.join(' + ') + (zusatzN ? ' +' + zusatzN + ' Zusatz' : '')).slice(0, 160);
    const beschreibung = 'Online gebucht – ' + kalk.gewaehlt.join(', ') + (fzt ? ' · ' + fzt : '') + (zoll ? ' · ' + zoll + ' Zoll' : '');

    await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['termin:' + datum]);
      const konflikt = await client.query(
        "SELECT COUNT(*) FROM termine WHERE datum=$1 AND status NOT IN ('storniert','abgesagt') AND uhrzeit_von < $3 AND uhrzeit_bis > $2",
        [datum, uhrzeit_von, uhrzeit_bis]);
      if (parseInt(konflikt.rows[0].count) >= maxParallel) { const e = new Error('Dieser Termin ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen.'); e.status = 409; throw e; }
      await client.query(
        `INSERT INTO termine (kontakt_name, kontakt_anrede, kontakt_vorname, kontakt_nachname, kontakt_telefon, kontakt_email,
           kontakt_strasse, kontakt_plz, kontakt_ort, fahrzeugtyp, datum, uhrzeit_von, uhrzeit_bis, termin_typ, beschreibung,
           kennzeichen, artikel_id, leistungen, datenschutz_am, werbung_einwilligung, status, portal_buchung)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),$19,'bestaetigt',true)`,
        [nm, an, vn, nn, tel, em, str, pz, or, fzt, datum, uhrzeit_von, uhrzeit_bis, terminTyp, beschreibung, kz, mainArtId, JSON.stringify(kalk.positionen), werbung === true]);
    });

    try {
      const einst = o.einst;
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      const dF = datum.split('-').reverse().join('.');
      const eur = (n) => (Number(n) || 0).toFixed(2).replace('.', ',') + ' €';
      const posHtml = kalk.positionen.map(p => p.bezeichnung + ': ' + eur(p.grundpreis_netto) + (p.zuschlag_netto > 0 ? ' + Zuschlag ' + (p.fahrzeugtyp || '') + ': ' + eur(p.zuschlag_netto) : '')).join('<br>');
      const htmlGast = portalMailHtml(einst, {
        titel: 'Ihr Termin ist bestätigt', name: vn,
        absaetze: ['vielen Dank für Ihre Terminbuchung bei Schröder &amp; Scholz.',
          '<strong>Datum:</strong> ' + dF + '<br><strong>Uhrzeit:</strong> ' + uhrzeit_von + ' Uhr<br><strong>Kennzeichen:</strong> ' + kz + (fzt ? ' (' + fzt + ')' : ''),
          '<strong>Leistungen (Schätzung, netto):</strong><br>' + posHtml + '<br><strong>Gesamt (brutto):</strong> ' + eur(kalk.brutto)],
        hinweis: 'Die Preise sind eine unverbindliche Schätzung; der Endpreis kann je nach Aufwand abweichen. Bei Fragen erreichen Sie uns' + (einst.telefon ? ' unter ' + einst.telefon : '') + '. Bitte sagen Sie rechtzeitig ab, falls Sie verhindert sind.'
      });
      await transporter.sendMail({ from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: em, replyTo: einst.email || process.env.SMTP_USER, subject: 'Terminbestätigung ' + dF + ' ' + uhrzeit_von + ' Uhr — Schröder & Scholz', html: htmlGast });
      if (einst.email) {
        await transporter.sendMail({ from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: einst.email, replyTo: em,
          subject: 'Neue Online-Buchung (Gast): ' + terminTyp + ' am ' + dF + ' ' + uhrzeit_von,
          html: '<p><strong>Neue Gäste-Buchung über die Homepage:</strong></p><p>' + (an ? an + ' ' : '') + nm + '<br>' + str + ', ' + pz + ' ' + or + '<br>Telefon: ' + tel + '<br>E-Mail: ' + em + '<br>Kennzeichen: ' + kz + (fzt ? ' · ' + fzt : '') + (zoll ? ' · ' + zoll + ' Zoll' : '') + '<br>Datum: ' + dF + ' ' + uhrzeit_von + ' Uhr (' + dauer + ' Min)</p><p>Leistungen:<br>' + posHtml + '<br><strong>Gesamt brutto: ' + eur(kalk.brutto) + '</strong></p><p>Werbe-Einwilligung: ' + (werbung === true ? 'ja' : 'nein') + '</p>' });
      }
    } catch (mailErr) { console.error('[Gast-Buchung-Mail]', mailErr.message); }

    res.status(201).json({ message: 'ok', datum: datum, uhrzeit_von: uhrzeit_von, leistungen: kalk.gewaehlt, summe_brutto: kalk.brutto });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

module.exports = router;
