'use strict';
// Oeffentliche Gaeste-Terminbuchung (ohne Kundenkonto) – mehrstufiger Assistent auf /termin/.
// Liegt auf dem Server unter src/routes/gast.js. Gemountet (oeffentlich) als /api/gast.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query, withTransaction } = require('../db/index');
const { portalMailHtml } = require('../lib/mail-template');
const { resolvePreis } = require('../lib/preis');
const oeffnung = require('../lib/oeffnung');

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
const FZ_TYPEN = ['PKW', 'SUV', 'Transporter', 'Motorrad', 'Sonstiges'];
// Gutschein-Code normalisieren: Steuerzeichen (inkl. NUL -> sonst Postgres-500) UND Leerzeichen raus
// (konsistent zur Admin-Pruefung), auf 40 Zeichen begrenzt. Vergleich in der Query ist ohnehin UPPER().
const normGutschein = (s) => String(s == null ? '' : s).replace(/[\s\x00-\x1F]/g, '').slice(0, 40);

// Baut die Kalkulationspositionen: je Leistung Grundpreis + (getrennt) Fahrzeug-Zuschlag.
// typ = gewaehlter Fahrzeugtyp (z.B. SUV), zoll = Zollgroesse (optional).
async function baueKalkulation(mainIds, zusatzIds, typ, zoll) {
  // Nur gueltige UUIDs zulassen + Anzahl begrenzen -> kein 500 durch uuid-Typfehler, kein Ressourcen-DoS.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const nurUuid = (a) => (Array.isArray(a) ? a : []).filter((x) => UUID_RE.test(String(x))).slice(0, 20);
  mainIds = nurUuid(mainIds); zusatzIds = nurUuid(zusatzIds);
  const ids = mainIds.concat(zusatzIds);
  const leer = { positionen: [], netto: 0, mwst: 0, brutto: 0, dauer: 30, gewaehlt: [] };
  if (!ids.length) return leer;
  const inkl = (((await query('SELECT preise_inkl_mwst FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {}).preise_inkl_mwst) !== false; // Standard: Preise inkl. MwSt (Brutto)
  const arts = (await query('SELECT * FROM artikel WHERE id = ANY($1::uuid[]) AND aktiv IS NOT false', [ids])).rows;
  const vars = (await query('SELECT * FROM artikel_preise WHERE artikel_id = ANY($1::uuid[])', [ids])).rows;
  const byArt = {}; arts.forEach(function (a) { byArt[a.id] = a; });
  const varsByArt = {}; vars.forEach(function (v) { (varsByArt[v.artikel_id] = varsByArt[v.artikel_id] || []).push(v); });
  const order = mainIds.map(function (id) { return { id: id, rolle: 'haupt' }; })
    .concat(zusatzIds.map(function (id) { return { id: id, rolle: 'zusatz' }; }));
  const positionen = []; let netto = 0, brutto = 0, dauer = 0; const gewaehlt = [];
  order.forEach(function (it) {
    const a = byArt[it.id]; if (!a) return;
    const variants = varsByArt[a.id] || [];
    const basis = resolvePreis(a, variants, null, zoll);          // ohne Fahrzeugtyp-Zuschlag
    const eff = resolvePreis(a, variants, typ || null, zoll);     // mit gewaehltem Typ
    const effPreis = Number(eff.preis) || 0;
    const grundPreis = Math.min(Number(basis.preis) || 0, effPreis);
    const satz = Number(eff.mwst_satz != null ? eff.mwst_satz : 19);
    const f = 1 + satz / 100;
    // inkl=true: gespeicherter Preis ist Brutto (Endpreis), Netto abgeleitet. inkl=false: Preis ist Netto.
    const nettoVon = function (p) { return inkl ? round2(p / f) : round2(p); };
    const bruttoVon = function (p) { return inkl ? round2(p) : round2(p * f); };
    const grund = nettoVon(grundPreis);
    const zuschlag = round2(nettoVon(effPreis) - grund);
    const zeilenNetto = nettoVon(effPreis);
    const zeilenBrutto = bruttoVon(effPreis);
    netto = round2(netto + zeilenNetto);
    brutto = round2(brutto + zeilenBrutto);
    dauer += (eff.dauer_minuten != null ? eff.dauer_minuten : (a.dauer_minuten || 30));
    gewaehlt.push(a.name);
    positionen.push({
      artikel_id: a.id, bezeichnung: a.name, rolle: it.rolle,
      grundpreis_netto: grund, zuschlag_netto: zuschlag,
      fahrzeugtyp: zuschlag > 0 ? (typ || null) : null,
      mwst_satz: satz, zeilen_netto: zeilenNetto, zeilen_brutto: zeilenBrutto
    });
  });
  return { positionen: positionen, netto: round2(netto), mwst: round2(brutto - netto), brutto: round2(brutto), dauer: Math.min(dauer || 30, 480), gewaehlt: gewaehlt };
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
  const gebuchte = (await query("SELECT uhrzeit_von, uhrzeit_bis FROM termine WHERE datum=$1 AND status NOT IN ('storniert','abgesagt') AND NOT (status='angefragt' AND bestaetigung_token IS NOT NULL)", [datum])).rows;
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
    // preise_inkl_mwst + buchbar_ab gemeinsam laden. buchbar_ab per to_char als YYYY-MM-DD (kein
    // Date-Objekt -> kein UTC-Vortag-Bug), damit das /termin/-Frontend sein Mindestdatum dynamisch zieht.
    const einst0 = (await query("SELECT preise_inkl_mwst, to_char(buchbar_ab,'YYYY-MM-DD') AS buchbar_ab FROM einstellungen ORDER BY id LIMIT 1")).rows[0] || {};
    const inkl = einst0.preise_inkl_mwst !== false;
    const minByArt = {};
    vars.forEach(v => { const p = Number(v.preis); if (minByArt[v.artikel_id] == null || p < minByArt[v.artikel_id]) minByArt[v.artikel_id] = p; });
    rows.forEach(r => {
      const basis = r.preis != null ? Number(r.preis) : null;
      let ab = basis;
      if (minByArt[r.artikel_id] != null) ab = (ab == null) ? minByArt[r.artikel_id] : Math.min(ab, minByArt[r.artikel_id]);
      const satz = Number(r.mwst_satz != null ? r.mwst_satz : 19);
      const f = 1 + satz / 100;
      r.ab_netto = ab != null ? (inkl ? round2(ab / f) : round2(ab)) : null;
      r.ab_brutto = ab != null ? (inkl ? round2(ab) : round2(ab * f)) : null;
    });
    res.json({
      haupt: rows.filter(r => r.rolle === 'haupt'),
      zusatz: rows.filter(r => r.rolle === 'zusatz'),
      buchbar_ab: einst0.buchbar_ab || null
    });
  } catch (e) { next(e); }
});

// Live-Kalkulation: gewaehlte Leistungen + Fahrzeugtyp/Zoll -> itemisierte Positionen (Grundpreis + Zuschlag)
// Oeffentliche Gutschein-Pruefung fuer die /termin/-Buchung (ohne Login). 200 AUCH bei ungueltig
// (gueltig:false), damit das Frontend die Feld-Validierung sauber als "ungueltig" anzeigen kann.
// Gueltig nur bei aktiv + nicht abgelaufen + rabatt_prozent > 0.
router.get('/gutschein/:code', limiter, async (req, res, next) => {
  try {
    const code = normGutschein(req.params.code);
    if (!code) return res.json({ gueltig: false });
    const g = (await query(
      `SELECT code, beschreibung, rabatt_prozent FROM gutscheine
       WHERE UPPER(code)=UPPER($1) AND aktiv=true AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE) AND rabatt_prozent > 0 AND rabatt_prozent <= 100`,
      [code])).rows[0];
    if (!g) return res.json({ gueltig: false });
    res.json({ gueltig: true, code: g.code, rabatt_prozent: g.rabatt_prozent, beschreibung: g.beschreibung || null });
  } catch (e) { next(e); }
});

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
    if (payload.z === 'bewertung') {
      await query('UPDATE kunden SET einwilligung_bewertung=false, einwilligung_bewertung_am=NULL, widerruf_datum=NOW(), geaendert_am=NOW() WHERE id=$1', [payload.id]);
      return res.send(seite('Abgemeldet', 'Sie erhalten keine Bewertungsanfragen mehr. Falls Sie das später ändern möchten, können Sie die Einwilligung in Ihrem Kundenportal erneut erteilen.'));
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
    // Abgelaufene, unbestaetigte Gast-Buchungen aufraeumen (nur mit Token -> Sammeltermine unberuehrt),
    // damit befristet gehaltene Slots wieder frei werden.
    await query("DELETE FROM termine WHERE status='angefragt' AND bestaetigung_token IS NOT NULL AND bestaetigung_token_ablauf < NOW()");
    const splitList = (s) => Array.isArray(s) ? s.filter(Boolean) : String(s || '').split(',').map(x => x.trim()).filter(Boolean);
    let mainIds = splitList(b.main_ids);
    if (!mainIds.length && (b.main_artikel_id || b.artikel_id)) mainIds = [b.main_artikel_id || b.artikel_id];
    const zusatzIds = splitList(b.zusatz_ids);
    // Nur gueltige UUIDs + Anzahl begrenzen (mainIds[0] fliesst als artikel_id in den INSERT -> sonst 500).
    // Bleibt nichts uebrig, greift unten die Pflichtfeldpruefung (400 statt 500).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    mainIds = mainIds.filter((x) => UUID_RE.test(String(x))).slice(0, 20);
    const { anrede, vorname, nachname, telefon, email, strasse, plz, ort, fahrzeugtyp, zoll, kennzeichen, datum, uhrzeit_von, datenschutz, werbung } = b;
    if (!vorname || !nachname || !telefon || !email || !kennzeichen || !strasse || !plz || !ort || !datum || !uhrzeit_von || !mainIds.length)
      return res.status(400).json({ error: 'Bitte alle Pflichtfelder ausfüllen (inkl. Anschrift und mindestens eine Leistung).' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !/^\d{2}:\d{2}/.test(uhrzeit_von)) return res.status(400).json({ error: 'Ungültiges Datum oder Uhrzeit.' });
    if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
    if (datenschutz !== true) return res.status(400).json({ error: 'Bitte bestätigen Sie die Kenntnisnahme der Datenschutzerklärung.' });
    // Sanftes Cool-down gegen Mail-Bombing einer fremden Adresse: max. 2 OFFENE (unbestaetigte) Anfragen
    // je Ziel-E-Mail. KEIN 24h-Hard-Lock -> bestaetigte Termine zaehlen nicht (nach Bestaetigung sofort
    // wieder buchbar), unbestaetigte laufen nach 45 Min ab (selbstheilend) -> kein Dauer-Lockout eines
    // legitimen Nutzers, aber pro Adresse hoechstens ~2 "bitte bestaetigen"-Mails gleichzeitig offen.
    const emailLc = String(email).toLowerCase().slice(0, 160);
    const offen = await query("SELECT COUNT(*)::int AS c FROM termine WHERE LOWER(kontakt_email)=$1 AND status='angefragt' AND bestaetigung_token IS NOT NULL AND bestaetigung_token_ablauf > NOW()", [emailLc]);
    if (offen.rows[0].c >= 2) return res.status(429).json({ error: 'Für diese E-Mail-Adresse liegen bereits offene Terminanfragen vor. Bitte bestätigen Sie diese zunächst über den Link in unserer E-Mail.' });
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
    // Buchungsstart serverseitig durchsetzen (Frontend allein ist per direktem Request umgehbar): vor
    // einstellungen.buchbar_ab keine Online-Buchung. src/db/index.js parst 'date' (OID 1082) global als
    // rohen 'YYYY-MM-DD'-String -> hier greift der String-Zweig (deckungsgleich mit to_char in /leistungen).
    // Der Date-Zweig ist nur defensive Absicherung, falls der Typ-Parser je entfernt wird (kein UTC-Vortag-Bug).
    if (o.einst.buchbar_ab) {
      const b = o.einst.buchbar_ab;
      const bStr = (b instanceof Date)
        ? b.getFullYear() + '-' + String(b.getMonth() + 1).padStart(2, '0') + '-' + String(b.getDate()).padStart(2, '0')
        : String(b).slice(0, 10);
      if (datum < bStr) return res.status(409).json({ error: 'Online-Buchungen sind erst ab dem ' + bStr.split('-').reverse().join('.') + ' möglich.' });
    }
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
    const tel = noTag(telefon).slice(0, 60), em = noTag(email).slice(0, 160), kz = noTag(kennzeichen).slice(0, 20);
    const an = ['Herr', 'Frau', 'Divers', 'Firma'].includes(anrede) ? anrede : null;
    const str = noTag(strasse).slice(0, 160), pz = noTag(plz).slice(0, 12), or = noTag(ort).slice(0, 120);
    const mainArtId = mainIds[0];
    const hauptNamen = kalk.positionen.filter(p => p.rolle === 'haupt').map(p => p.bezeichnung);
    const zusatzN = kalk.positionen.filter(p => p.rolle === 'zusatz').length;
    const terminTyp = (hauptNamen.join(' + ') + (zusatzN ? ' +' + zusatzN + ' Zusatz' : '')).slice(0, 160);
    const beschreibung = 'Online gebucht – ' + kalk.gewaehlt.join(', ') + (fzt ? ' · ' + fzt : '') + (zoll ? ' · ' + zoll + ' Zoll' : '');

    // Gutschein serverseitig pruefen (nur aktiver, nicht abgelaufener Code mit Rabatt > 0). Der zum
    // Buchungszeitpunkt validierte Prozentsatz wird am Termin EINGEFROREN (verbindliche Zusage; das
    // Rechnungswesen zieht genau diesen Wert in "Rechnung aus Termin"). Ungueltig -> kein Rabatt, kein Fehler.
    let gutscheinCode = null, gutscheinRabatt = null;
    const gcRaw = normGutschein(b.gutschein_code);
    if (gcRaw) {
      const gc = (await query(
        `SELECT code, rabatt_prozent FROM gutscheine
         WHERE UPPER(code)=UPPER($1) AND aktiv=true AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE) AND rabatt_prozent > 0 AND rabatt_prozent <= 100`,
        [gcRaw])).rows[0];
      if (gc) { gutscheinCode = gc.code; gutscheinRabatt = gc.rabatt_prozent; }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const ablauf = new Date(Date.now() + 45 * 60000); // 45-Min-Bestaetigungsfenster (haelt den Slot befristet)

    await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['termin:' + datum]);
      const konflikt = await client.query(
        "SELECT COUNT(*) FROM termine WHERE datum=$1 AND status NOT IN ('storniert','abgesagt') AND NOT (status='angefragt' AND bestaetigung_token IS NOT NULL) AND uhrzeit_von < $3 AND uhrzeit_bis > $2",
        [datum, uhrzeit_von, uhrzeit_bis]);
      if (parseInt(konflikt.rows[0].count) >= maxParallel) { const e = new Error('Dieser Termin ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen.'); e.status = 409; throw e; }
      // Double-Opt-in: erst 'angefragt' + Bestaetigungstoken. Wird erst nach Klick auf den Mail-Link 'bestaetigt'
      // -> keine "bestaetigt"-Mail an unverifizierte Fremdadressen (Relay/Spam), nur befristeter Slot-Halt.
      await client.query(
        `INSERT INTO termine (kontakt_name, kontakt_anrede, kontakt_vorname, kontakt_nachname, kontakt_telefon, kontakt_email,
           kontakt_strasse, kontakt_plz, kontakt_ort, fahrzeugtyp, datum, uhrzeit_von, uhrzeit_bis, termin_typ, beschreibung,
           kennzeichen, artikel_id, leistungen, datenschutz_am, werbung_einwilligung, status, portal_buchung,
           bestaetigung_token, bestaetigung_token_ablauf, gutschein_code, gutschein_rabatt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),$19,'angefragt',true,$20,$21,$22,$23)`,
        [nm, an, vn, nn, tel, em, str, pz, or, fzt, datum, uhrzeit_von, uhrzeit_bis, terminTyp, beschreibung, kz, mainArtId, JSON.stringify(kalk.positionen), werbung === true, token, ablauf, gutscheinCode, gutscheinRabatt]);
    });

    // Nur EINE Mail an den (noch unverifizierten) Gast: der Bestaetigungslink. Admin-Mail + finale
    // Bestaetigungsmail erst nach Klick (siehe GET /termin/bestaetigen).
    try {
      const einst = o.einst;
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      const dF = datum.split('-').reverse().join('.');
      const link = 'https://www.schroeder-scholz.de/api/gast/termin/bestaetigen?token=' + token;
      const htmlGast = portalMailHtml(einst, {
        titel: 'Bitte bestätigen Sie Ihre Terminanfrage', name: vn,
        absaetze: ['vielen Dank für Ihre Terminanfrage bei Schröder &amp; Scholz.',
          '<strong>Datum:</strong> ' + dF + '<br><strong>Uhrzeit:</strong> ' + uhrzeit_von + ' Uhr<br><strong>Kennzeichen:</strong> ' + kz + (fzt ? ' (' + fzt + ')' : '') + (gutscheinCode ? '<br><strong>Gutschein:</strong> ' + gutscheinCode + ' (−' + gutscheinRabatt + ' %)' : ''),
          'Ihr Termin ist noch <strong>nicht verbindlich</strong>. Bitte bestätigen Sie ihn innerhalb von 45 Minuten mit einem Klick auf den Button — erst dann ist er fest gebucht.'],
        button: { text: 'Termin verbindlich bestätigen', url: link },
        hinweis: 'Wenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail einfach — es wird kein Termin gebucht. Der Link ist 45 Minuten gültig.'
      });
      await transporter.sendMail({ from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: em, replyTo: einst.email || process.env.SMTP_USER, subject: 'Bitte bestätigen: Terminanfrage ' + dF + ' ' + uhrzeit_von + ' Uhr — Schröder & Scholz', html: htmlGast });
    } catch (mailErr) { console.error('[Gast-Buchung-Mail]', mailErr.message); }

    res.status(201).json({ message: 'bestaetigung_noetig', datum: datum, uhrzeit_von: uhrzeit_von, leistungen: kalk.gewaehlt, summe_brutto: kalk.brutto, gutschein_code: gutscheinCode, gutschein_rabatt: gutscheinRabatt });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// Wiederverwendbare, einfache HTML-Statusseite fuer die oeffentliche Bestaetigung.
function gastSeite(titel, textHtml, extraHtml) {
  return '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + titel + ' — Schröder &amp; Scholz</title>' +
    '<style>body{font-family:-apple-system,Arial,sans-serif;background:#f4f5f7;color:#1a1a1a;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}.box{background:#fff;border-radius:16px;padding:34px 30px;max-width:460px;text-align:center;box-shadow:0 14px 34px rgba(0,0,0,.1);border-top:4px solid #eab308}h1{font-size:20px;color:#171717;margin:0 0 10px}p{color:#555;font-size:15px}a{color:#171717}button{background:#eab308;color:#171717;border:none;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer}</style></head><body><div class="box"><h1>' + titel + '</h1><p>' + textHtml + '</p>' + (extraHtml || '') + '<p style="margin-top:18px"><a href="https://www.schroeder-scholz.de/">Zur Startseite</a></p></div></body></html>';
}
const escAttr = (s) => String(s == null ? '' : s).replace(/[<>"'&]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' })[c]; });

// Double-Opt-in Bestaetigung. GET zeigt NUR eine Seite mit Bestaetigungs-Button (KEIN Zustandswechsel!),
// damit automatische Mail-Link-Scanner (Safe Links, URL Defense, ...) den Termin nicht per Prefetch bestaetigen.
// Erst der POST (Klick auf den Button) macht die Buchung nach Slot-Neucheck verbindlich.
router.get('/termin/bestaetigen', limiter, async (req, res, next) => {
  try {
    await query("DELETE FROM termine WHERE status='angefragt' AND bestaetigung_token IS NOT NULL AND bestaetigung_token_ablauf < NOW()");
    const token = req.query.token;
    if (!token) return res.status(400).send(gastSeite('Link unvollständig', 'Der Bestätigungslink ist nicht vollständig.'));
    const t = (await query("SELECT to_char(datum,'YYYY-MM-DD') AS datum_str, uhrzeit_von FROM termine WHERE bestaetigung_token=$1 AND status='angefragt' AND bestaetigung_token_ablauf > NOW()", [token])).rows[0];
    if (!t) return res.status(400).send(gastSeite('Link ungültig oder abgelaufen', 'Dieser Bestätigungslink ist nicht mehr gültig (evtl. bereits bestätigt oder abgelaufen). Bitte buchen Sie bei Bedarf erneut über unsere Terminseite.'));
    const dF = t.datum_str.split('-').reverse().join('.');
    const hhmm = String(t.uhrzeit_von).substring(0, 5);
    // Relatives Ziel (gleiche Route, gleicher Token): der Button postet immer an DIE Instanz,
    // die die Seite ausgeliefert hat. Mit absoluter Live-URL landete ein Klick auf einer Test-
    // instanz sonst auf der Produktivumgebung.
    const form = '<form method="post" action="?token=' + escAttr(token) + '" style="margin-top:8px"><button type="submit">Termin verbindlich bestätigen</button></form>';
    return res.send(gastSeite('Noch ein Klick: Termin bestätigen', 'Bitte bestätigen Sie Ihren Termin am <strong>' + dF + '</strong> um <strong>' + hhmm + ' Uhr</strong> verbindlich.', form));
  } catch (e) { next(e); }
});

router.post('/termin/bestaetigen', limiter, async (req, res, next) => {
  try {
    await query("DELETE FROM termine WHERE status='angefragt' AND bestaetigung_token IS NOT NULL AND bestaetigung_token_ablauf < NOW()");
    const token = req.query.token || (req.body && req.body.token);
    if (!token) return res.status(400).send(gastSeite('Link unvollständig', 'Der Bestätigungslink ist nicht vollständig.'));
    const t = (await query("SELECT *, to_char(datum,'YYYY-MM-DD') AS datum_str FROM termine WHERE bestaetigung_token=$1 AND status='angefragt' AND bestaetigung_token_ablauf > NOW()", [token])).rows[0];
    if (!t) return res.status(400).send(gastSeite('Link ungültig oder abgelaufen', 'Dieser Bestätigungslink ist nicht mehr gültig (evtl. bereits bestätigt oder abgelaufen). Bitte buchen Sie bei Bedarf erneut über unsere Terminseite.'));

    // Slot unter Advisory-Lock erneut pruefen (koennte inzwischen fest belegt sein), dann verbindlich buchen.
    let ok = false;
    await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['termin:' + t.datum_str]);
      const einst = (await client.query('SELECT max_parallele_termine FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
      const maxParallel = einst.max_parallele_termine || 1;
      const konflikt = await client.query(
        "SELECT COUNT(*) FROM termine WHERE datum=$1 AND id<>$2 AND status IN ('bestaetigt','abgeschlossen') AND uhrzeit_von < $4 AND uhrzeit_bis > $3",
        [t.datum_str, t.id, t.uhrzeit_von, t.uhrzeit_bis]);
      if (parseInt(konflikt.rows[0].count) >= maxParallel) return; // Slot inzwischen fest belegt
      // Status-Guard -> genau EINMAL bestaetigen (kein zweiter Mailversand bei Doppel-POST/Race).
      const upd = await client.query("UPDATE termine SET status='bestaetigt', bestaetigung_token=NULL, bestaetigung_token_ablauf=NULL, geaendert_am=NOW() WHERE id=$1 AND status='angefragt'", [t.id]);
      if (upd.rowCount > 0) ok = true;
    });
    if (!ok) {
      // Nur bei echtem Slot-Konflikt (noch 'angefragt') absagen; bei bereits bestaetigt (Race/Doppelklick) nichts aendern.
      const upd2 = await query("UPDATE termine SET status='abgesagt', bestaetigung_token=NULL, bestaetigung_token_ablauf=NULL WHERE id=$1 AND status='angefragt'", [t.id]);
      const txt = upd2.rowCount > 0 ? 'Der gewünschte Termin ist inzwischen belegt. Bitte buchen Sie einen neuen Termin über unsere Terminseite.'
        : 'Dieser Termin wurde bereits bestätigt. Sie haben die Bestätigung per E-Mail erhalten.';
      return res.status(409).send(gastSeite('Termin nicht bestätigt', txt));
    }

    // Erst jetzt die Mails: finale Bestaetigung an den (nun verifizierten) Gast + Admin-Benachrichtigung.
    try {
      const einst = (await query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      const dF = t.datum_str.split('-').reverse().join('.');
      const hhmm = String(t.uhrzeit_von).substring(0, 5);
      const eur = (n) => (Number(n) || 0).toFixed(2).replace('.', ',') + ' €';
      const pos = Array.isArray(t.leistungen) ? t.leistungen : (t.leistungen ? JSON.parse(t.leistungen) : []);
      // Kundenseitig NUR Brutto ausweisen (PAngV). Bei preise_inkl_mwst=true ist zeilen_brutto bereits der
      // Endpreis inkl. MwSt -> NICHT erneut mit dem Satz multiplizieren. Fallback fuer aeltere Datensaetze.
      const posBrutto = (p) => {
        if (p.zeilen_brutto != null) return Number(p.zeilen_brutto);
        const satz = Number(p.mwst_satz != null ? p.mwst_satz : 19);
        return round2((Number(p.grundpreis_netto || 0) + Number(p.zuschlag_netto || 0)) * (1 + satz / 100));
      };
      const posHtml = pos.map(p => p.bezeichnung + ': ab ' + eur(posBrutto(p))).join('<br>');
      const summeBrutto = round2(pos.reduce((s, p) => s + posBrutto(p), 0));
      // Interne Admin-Mail: Netto-Detail (Grundpreis + Zuschlag) statt der kundenseitigen Brutto-"ab"-Zeile
      // -> der Betrieb kalkuliert intern netto. Kundenmail bleibt reine Brutto-Schaetzung (PAngV).
      const posHtmlAdmin = pos.map(p => p.bezeichnung + ': ' + eur(p.grundpreis_netto)
        + (p.zuschlag_netto > 0 ? ' + Zuschlag ' + (p.fahrzeugtyp || '') + ': ' + eur(p.zuschlag_netto) : '') + ' (netto)').join('<br>');
      const preisBlock = posHtml
        ? ('<strong>Leistungen (unverbindliche Schätzung, inkl. MwSt):</strong><br>' + posHtml
           + '<br><strong>Summe (Schätzung): ab ' + eur(summeBrutto) + '</strong>'
           + (t.gutschein_code ? '<br>Gutschein ' + t.gutschein_code + ': −' + t.gutschein_rabatt + ' % (Anrechnung auf der Rechnung)' : '')
           + '<br><a href="https://www.schroeder-scholz.de/preise/" style="color:#171717">Alle Preise ansehen</a>')
        : '';
      // #6 Konto-CTA (sekundaer) unter dem Bestaetigungstext. E-Mail des Gastes vorbelegt; Backend behandelt
      // Bestandskunden sauber (Passwort-festlegen statt Doppelkonto). encodeURIComponent -> URL-sicher.
      const kontoUrlMail = 'https://www.schroeder-scholz.de/portal/?registrieren&email=' + encodeURIComponent(t.kontakt_email || '');
      // Nur Inline-Elemente (a/br/span) -> gueltig, da portalMailHtml jedes absaetze-Element in ein <p> wrappt
      // (eine <table> darin waere ungueltiges HTML und bricht in Outlook). Konsistent mit der gastSeite-CTA.
      const kontoCtaMail = '<a href="' + escAttr(kontoUrlMail) + '" style="display:inline-block;background:#eab308;color:#171717;text-decoration:none;border-radius:10px;padding:13px 30px;font-size:15px;font-weight:700">Kundenkonto erstellen</a>'
        + '<br><span style="display:inline-block;margin-top:10px;font-size:13px;color:#777">Termine online verwalten und Ihre eingelagerten Räder jederzeit einsehen.</span>';
      // Selbstbedienungs-Absage (PR1): ohne diesen Link bleibt dem Gast ohne Konto nur der Anruf.
      // Signierter Link, gueltig bis einen Tag nach dem Termin; Absage kostenfrei bis zur Stornofrist.
      const fristH = einst.stornierung_frist_h != null ? einst.stornierung_frist_h : 24;
      const absageZeile = 'Verhindert? Sie können Ihren Termin bis ' + fristH + ' Stunden vorher kostenfrei selbst absagen: '
        + '<a href="' + escAttr(stornoLink(t.id)) + '" style="color:#171717"><strong>Termin online absagen</strong></a>';
      const htmlGast = portalMailHtml(einst, {
        titel: 'Ihr Termin ist bestätigt', name: t.kontakt_vorname || '',
        absaetze: ['vielen Dank — Ihr Termin bei Schröder &amp; Scholz ist jetzt verbindlich gebucht.',
          '<strong>Datum:</strong> ' + dF + '<br><strong>Uhrzeit:</strong> ' + hhmm + ' Uhr<br><strong>Kennzeichen:</strong> ' + (t.kennzeichen || '') + (t.fahrzeugtyp ? ' (' + t.fahrzeugtyp + ')' : ''),
          preisBlock,
          absageZeile,
          kontoCtaMail],
        hinweis: 'Der Endpreis ist abhängig von Zollgröße und Fahrzeugart und kann vor Ort ggf. abweichen. Bei Fragen erreichen Sie uns' + (einst.telefon ? ' unter ' + einst.telefon : '') + '. Bitte sagen Sie rechtzeitig ab, falls Sie verhindert sind.'
      });
      await transporter.sendMail({ from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: t.kontakt_email, replyTo: einst.email || process.env.SMTP_USER, subject: 'Terminbestätigung ' + dF + ' ' + hhmm + ' Uhr — Schröder & Scholz', html: htmlGast });
      if (einst.email) {
        await transporter.sendMail({ from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: einst.email, replyTo: t.kontakt_email,
          subject: 'Neue Online-Buchung (Gast, bestätigt): ' + (t.termin_typ || '') + ' am ' + dF + ' ' + hhmm,
          html: '<p><strong>Neue (bestätigte) Gäste-Buchung über die Homepage:</strong></p><p>' + (t.kontakt_anrede ? t.kontakt_anrede + ' ' : '') + (t.kontakt_name || '') + '<br>' + (t.kontakt_strasse || '') + ', ' + (t.kontakt_plz || '') + ' ' + (t.kontakt_ort || '') + '<br>Telefon: ' + (t.kontakt_telefon || '') + '<br>E-Mail: ' + (t.kontakt_email || '') + '<br>Kennzeichen: ' + (t.kennzeichen || '') + (t.fahrzeugtyp ? ' · ' + t.fahrzeugtyp : '') + '<br>Datum: ' + dF + ' ' + hhmm + ' Uhr</p><p>Leistungen:<br>' + posHtmlAdmin + (t.gutschein_code ? '<br>Gutschein ' + t.gutschein_code + ': −' + t.gutschein_rabatt + ' %' : '') + '</p>' });
      }
    } catch (mailErr) { console.error('[Gast-Bestaetigung-Mail]', mailErr.message); }

    // "Konto erstellen"-CTA: E-Mail des bestaetigten Gastes vorbelegen. Backend behandelt Bestandskunden
    // ohnehin sauber (Passwort-festlegen-Link statt Doppelkonto). encodeURIComponent -> URL-sicher.
    const kontoUrl = 'https://www.schroeder-scholz.de/portal/?registrieren&email=' + encodeURIComponent(t.kontakt_email || '');
    const kontoCta = '<div style="margin-top:20px;padding-top:18px;border-top:1px solid #eee"><a href="' + escAttr(kontoUrl) + '" style="display:inline-block;background:#eab308;color:#171717;text-decoration:none;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:700">Kundenkonto erstellen</a><p style="margin:12px 0 0;color:#777;font-size:13px">Termine online verwalten und Ihre eingelagerten Räder jederzeit einsehen.</p></div>';
    res.send(gastSeite('Termin bestätigt!', 'Vielen Dank — Ihr Termin ist jetzt verbindlich gebucht. Sie erhalten die Bestätigung zusätzlich per E-Mail.', kontoCta));
  } catch (e) { next(e); }
});

// ── Selbstbedienung fuer Gast-Termine (ohne Kundenkonto): Termin selbst absagen ──
// Ohne diesen Weg ist der QR-/Flyer-Kunde in einer Sackgasse (nur Anruf). Der Link steht in der
// Bestaetigungsmail. Bewusst KEIN DB-Token: ein signiertes JWT (Termin-ID + Zweck) laeuft mit dem
// Termin ab und braucht keine Migration. Wer die Mail hat, darf absagen — mehr Rechte gibt der
// Token nicht (kein Lesen fremder Daten, keine Aenderung ausser Absage).
function stornoToken(terminId) {
  // Bewusst NICHT an das Termindatum gekoppelt: verschiebt die Werkstatt den Termin, wuerde ein
  // daran gebundener Token vor dem neuen Datum ablaufen. 180 Tage sind unbedenklich, weil der Link
  // ausschliesslich DIESEN einen Termin absagen kann und nur solange er 'bestaetigt' und noch nicht
  // innerhalb der Stornofrist ist (vergangene Termine sind dadurch automatisch ausgeschlossen).
  return jwt.sign({ tid: terminId, typ: 'gast-storno' }, process.env.JWT_SECRET, { expiresIn: '180d' });
}
function stornoLink(terminId) {
  return 'https://www.schroeder-scholz.de/api/gast/termin/absagen?token=' + stornoToken(terminId);
}

// Termin + Rahmendaten zum Storno-Token laden. Rueckgabe: { fehler } oder { t, einst, fristH, zuSpaet }.
async function ladeStornoTermin(token) {
  let payload = null;
  try { payload = jwt.verify(token || '', process.env.JWT_SECRET); } catch (e) { payload = null; }
  if (!payload || payload.typ !== 'gast-storno' || !payload.tid) {
    return { fehler: ['Link ungültig', 'Dieser Absagelink ist ungültig oder abgelaufen. Bitte rufen Sie uns an, wenn Sie Ihren Termin absagen möchten.'] };
  }
  const t = (await query("SELECT *, to_char(datum,'YYYY-MM-DD') AS datum_str FROM termine WHERE id=$1 AND kunden_id IS NULL", [payload.tid])).rows[0];
  if (!t) return { fehler: ['Termin nicht gefunden', 'Zu diesem Link gibt es keinen Termin mehr — er wurde entfernt oder inzwischen Ihrem Kundenkonto zugeordnet. Bitte sagen Sie in dem Fall im Kundenportal oder telefonisch ab; einen neuen Termin buchen Sie jederzeit über unsere Terminseite.'] };
  if (['storniert', 'abgesagt'].includes(t.status)) return { fehler: ['Bereits abgesagt', 'Dieser Termin ist bereits abgesagt. Sie können jederzeit einen neuen Termin buchen.'] };
  if (t.status === 'abgeschlossen') return { fehler: ['Nicht mehr möglich', 'Dieser Termin ist bereits abgeschlossen und kann nicht mehr abgesagt werden.'] };
  if (t.status !== 'bestaetigt') return { fehler: ['Noch nicht bestätigt', 'Dieser Termin ist noch nicht verbindlich bestätigt. Ohne Bestätigung verfällt er von selbst — Sie müssen nichts weiter tun.'] };
  // Bereits abgerechnet (Vorkasse/Vorab-Rechnung): nicht still stornieren, sonst haengt eine Rechnung
  // an einem stornierten Termin. Solche Faelle klaert der Betrieb persoenlich.
  if (t.fakturiert === true) return { fehler: ['Bitte telefonisch absagen', 'Zu diesem Termin liegt bereits eine Abrechnung vor. Bitte rufen Sie uns kurz an — wir klären die Absage persönlich mit Ihnen.'] };
  const einst = (await query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
  const telSatz = einst.telefon ? (' Bitte rufen Sie uns kurz an: ' + einst.telefon + '.') : ' Bitte melden Sie sich kurz telefonisch bei uns.';
  // Laeuft fuer den Termin schon die Abrechnung, darf der Kunde ihn nicht mehr still wegklicken —
  // sonst steht im Rechnungswesen ein stornierter Termin an einer bereits erstellten Rechnung.
  if (t.fakturiert || t.rechnung_id) {
    return { fehler: ['Bitte kurz anrufen', 'Für diesen Termin läuft bei uns bereits die Abrechnung, deshalb können wir ihn hier nicht mehr selbst absagen.' + telSatz] };
  }
  // != null statt || : eine bewusst auf 0 gesetzte Frist ("jederzeit stornierbar") darf nicht zu 24 werden.
  const fristH = einst.stornierung_frist_h != null ? einst.stornierung_frist_h : 24;
  // Fristvergleich AUSDRUECKLICH in Europe/Berlin statt in der Zeitzone des Node-Prozesses (bei einem
  // Server-/Container-Umzug auf UTC waere die Frist sonst um 1-2 Stunden verschoben). Beide Seiten als
  // 'YYYY-MM-DD HH:MM' in Berliner Zeit — Date.now() ist absolut, die Umrechnung macht toLocaleString.
  const grenze = new Date(Date.now() + fristH * 3600000).toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).substring(0, 16);
  const terminStr = t.datum_str + ' ' + String(t.uhrzeit_von || '00:00').substring(0, 5);
  const zuSpaet = terminStr < grenze;
  return { t: t, einst: einst, fristH: fristH, zuSpaet: zuSpaet };
}

// Eigenes Limit fuer die Absage: teilt es sich den Zaehler mit /leistungen, /slots und /kalkulation,
// koennte jemand mit ~30 sinnlosen Absage-Aufrufen die ganze Buchungsstrecke fuer seine IP (und alle
// dahinter, z.B. Firmennetz) 15 Minuten lang lahmlegen. Antwort als HTML-Seite, nicht als JSON —
// hier landet ein Mensch aus einer E-Mail, kein API-Client.
const absageLimiter = rateLimit({
  windowMs: 900000, max: 20,
  handler: (req, res) => res.status(429).send(gastSeite('Zu viele Anfragen', 'Bitte versuchen Sie es in einigen Minuten noch einmal — oder rufen Sie uns an, dann sagen wir den Termin für Sie ab.'))
});

// Erneut buchen — als Ausweg auf jeder Absage-Seite (keine Sackgasse).
const neuBuchenCta = '<div style="margin-top:20px;padding-top:18px;border-top:1px solid #eee"><a href="https://www.schroeder-scholz.de/termin/" style="display:inline-block;background:#eab308;color:#171717;text-decoration:none;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:700">Neuen Termin buchen</a></div>';

// GET zeigt NUR die Seite mit Absage-Button (kein Zustandswechsel!), damit Mail-Link-Scanner
// (Safe Links & Co.) den Termin nicht per Prefetch absagen. Erst der POST sagt wirklich ab.
router.get('/termin/absagen', absageLimiter, async (req, res, next) => {
  try {
    const r = await ladeStornoTermin(req.query.token);
    if (r.fehler) return res.status(400).send(gastSeite(r.fehler[0], r.fehler[1], neuBuchenCta));
    const dF = r.t.datum_str.split('-').reverse().join('.');
    const hhmm = String(r.t.uhrzeit_von).substring(0, 5);
    const tel = r.einst.telefon ? (' unter <strong>' + escAttr(r.einst.telefon) + '</strong>') : '';
    if (r.zuSpaet) {
      // 200: der GET aendert nichts und teilt nur mit, dass hier nur noch der Anruf hilft.
      return res.send(gastSeite('Absage nur noch telefonisch',
        'Ihr Termin am <strong>' + dF + '</strong> um <strong>' + hhmm + ' Uhr</strong> ist in weniger als ' + r.fristH + ' Stunden. So kurzfristig nehmen wir Absagen bitte persönlich entgegen — rufen Sie uns einfach an' + tel + '.'));
    }
    // Relatives Ziel (siehe Bestaetigung): postet an dieselbe Instanz, nicht fest auf die Live-Domain.
    const form = '<form method="post" action="?token=' + escAttr(req.query.token) + '" style="margin-top:8px"><button type="submit">Termin verbindlich absagen</button></form>';
    return res.send(gastSeite('Termin absagen?',
      'Möchten Sie Ihren Termin am <strong>' + dF + '</strong> um <strong>' + hhmm + ' Uhr</strong>' + (r.t.termin_typ ? ' (' + escAttr(r.t.termin_typ) + ')' : '') + ' wirklich absagen? Das ist kostenfrei und Sie können jederzeit neu buchen.', form));
  } catch (e) { next(e); }
});

router.post('/termin/absagen', absageLimiter, async (req, res, next) => {
  try {
    const token = req.query.token || (req.body && req.body.token);
    const r = await ladeStornoTermin(token);
    if (r.fehler) return res.status(400).send(gastSeite(r.fehler[0], r.fehler[1], neuBuchenCta));
    const dF = r.t.datum_str.split('-').reverse().join('.');
    const hhmm = String(r.t.uhrzeit_von).substring(0, 5);
    if (r.zuSpaet) {
      const tel = r.einst.telefon ? (' unter <strong>' + escAttr(r.einst.telefon) + '</strong>') : '';
      return res.status(409).send(gastSeite('Absage nur noch telefonisch',
        'Ihr Termin am <strong>' + dF + '</strong> um <strong>' + hhmm + ' Uhr</strong> ist in weniger als ' + r.fristH + ' Stunden. Bitte rufen Sie uns kurz an' + tel + '.'));
    }
    // Status-Guard: genau EINMAL stornieren (kein zweiter Mailversand bei Doppelklick/Reload).
    // `fakturiert IS NOT TRUE` auch hier im WHERE: der Zustand kann sich zwischen Pruefung und
    // Update geaendert haben. storniert_von bleibt beim Muster des Portal-Stornos ('kunde'), mit
    // Zusatz woher die Absage kam.
    const upd = await query(
      "UPDATE termine SET status='storniert', storniert_am=NOW(), storniert_von='kunde (gast-online)', geaendert_am=NOW() WHERE id=$1 AND status='bestaetigt' AND fakturiert IS NOT TRUE",
      [r.t.id]);
    if (!upd.rowCount) {
      return res.status(409).send(gastSeite('Bereits abgesagt', 'Dieser Termin ist bereits abgesagt. Sie können jederzeit einen neuen Termin buchen.', neuBuchenCta));
    }

    // Mails: Bestaetigung an den Gast + Info an den Betrieb (der Slot ist wieder frei).
    try {
      const einst = r.einst;
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      const htmlGast = portalMailHtml(einst, {
        titel: 'Ihr Termin ist abgesagt', name: r.t.kontakt_vorname || '',
        absaetze: ['Ihr Termin bei Schröder &amp; Scholz wurde wie gewünscht abgesagt.',
          '<strong>Datum:</strong> ' + dF + '<br><strong>Uhrzeit:</strong> ' + hhmm + ' Uhr' + (r.t.kennzeichen ? '<br><strong>Kennzeichen:</strong> ' + escAttr(r.t.kennzeichen) : ''),
          'Sie können jederzeit einen neuen Termin buchen — wir freuen uns auf Sie.'],
        button: { text: 'Neuen Termin buchen', url: 'https://www.schroeder-scholz.de/termin/' },
        hinweis: 'Es entstehen Ihnen keine Kosten.' + (einst.telefon ? ' Bei Fragen erreichen Sie uns unter ' + einst.telefon + '.' : '')
      });
      if (r.t.kontakt_email) {
        await transporter.sendMail({ from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: r.t.kontakt_email, replyTo: einst.email || process.env.SMTP_USER, subject: 'Termin abgesagt: ' + dF + ' ' + hhmm + ' Uhr — Schröder & Scholz', html: htmlGast });
      }
      if (einst.email) {
        await transporter.sendMail({ from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: einst.email, replyTo: r.t.kontakt_email || process.env.SMTP_USER,
          subject: 'Gast-Termin abgesagt: ' + (r.t.termin_typ || '') + ' am ' + dF + ' ' + hhmm,
          // Escaping, obwohl Gast-Freitext beim Buchen bereits von <> befreit wird (doppelter Boden,
          // falls dieselben Daten je aus einem anderen Pfad ohne diese Filterung stammen).
          html: '<p><strong>Ein Gast hat seinen Termin online abgesagt — der Slot ist wieder frei:</strong></p><p>' + escAttr(r.t.kontakt_name || '') + '<br>Telefon: ' + escAttr(r.t.kontakt_telefon || '') + '<br>E-Mail: ' + escAttr(r.t.kontakt_email || '') + '<br>Kennzeichen: ' + escAttr(r.t.kennzeichen || '') + '<br>Termin: ' + dF + ' ' + hhmm + ' Uhr<br>Leistung: ' + escAttr(r.t.termin_typ || '') + '</p>' });
      }
    } catch (mailErr) { console.error('[Gast-Absage-Mail]', mailErr.message); }

    res.send(gastSeite('Termin abgesagt', 'Ihr Termin am <strong>' + dF + '</strong> um <strong>' + hhmm + ' Uhr</strong> ist abgesagt. Sie erhalten die Bestätigung zusätzlich per E-Mail — es entstehen Ihnen keine Kosten.', neuBuchenCta));
  } catch (e) { next(e); }
});

module.exports = router;
