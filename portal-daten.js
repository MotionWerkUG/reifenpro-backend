'use strict';
const express = require('express');
const router = express.Router();
const { query } = require('../db/index');
const { authKunde } = require('./portal-auth');
const { resolvePreis } = require('../lib/preis');
const fs = require('fs');

// ── GET /api/portal/daten/einlagerungen ──
router.get('/einlagerungen', authKunde, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.*, 
        k.kennzeichen, k.fahrzeug_marke, k.fahrzeug_modell
       FROM einlagerungen e
       JOIN kunden k ON k.id = e.kunden_id
       WHERE e.kunden_id = $1
       ORDER BY e.eingelagert_am DESC`,
      [req.kunde.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── GET /api/portal/daten/termine ──
router.get('/termine', authKunde, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.*, a.name as artikel_name, a.dauer_minuten
       FROM termine t
       LEFT JOIN artikel a ON a.id = t.artikel_id
       WHERE t.kunden_id = $1 AND t.datum >= CURRENT_DATE
       ORDER BY t.datum, t.uhrzeit_von`,
      [req.kunde.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── GET /api/portal/daten/termine/vergangen ──
router.get('/termine/vergangen', authKunde, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.*, a.name as artikel_name, a.dauer_minuten
       FROM termine t
       LEFT JOIN artikel a ON a.id = t.artikel_id
       WHERE t.kunden_id = $1 AND t.datum < CURRENT_DATE
       ORDER BY t.datum DESC, t.uhrzeit_von DESC
       LIMIT 20`,
      [req.kunde.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── GET /api/portal/daten/freie-slots ──
// Gibt freie 15-Minuten-Slots fuer ein Datum und einen Artikel zurueck
router.get('/freie-slots', authKunde, async (req, res, next) => {
  try {
    const { datum, artikel_id } = req.query;
    if (!datum || !artikel_id) return res.status(400).json({ error: 'datum und artikel_id erforderlich' });

    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0];
    if (!einst) return res.status(500).json({ error: 'Einstellungen fehlen' });

    // Artikel + Preisstaffel laden, effektive Dauer nach Typ/Zoll ermitteln
    const artRes = await query('SELECT * FROM artikel WHERE id=$1 AND aktiv=true', [artikel_id]);
    if (!artRes.rows.length) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    const varianten = (await query('SELECT * FROM artikel_preise WHERE artikel_id=$1', [artikel_id])).rows;
    const eff = resolvePreis(artRes.rows[0], varianten, req.query.typ || null, req.query.zoll);
    const dauer = eff.dauer_minuten || 30;

    // Wochentag bestimmen
    const d = new Date(datum);
    const wochentag = d.getDay(); // 0=So, 1=Mo, ..., 6=Sa

    // Betriebsurlaub pruefen
    const urlaub = await query(
      'SELECT id FROM betriebsurlaub WHERE von_datum <= $1 AND bis_datum >= $1',
      [datum]
    );
    if (urlaub.rows.length) return res.json({ slots: [], grund: 'Betriebsurlaub' });

    // Bayerische Feiertage pruefen
    if (isFeiertag(d)) return res.json({ slots: [], grund: 'Feiertag' });

    // Oeffnungszeiten bestimmen
    let vonStr, bisStr;
    if (wochentag === 0) {
      if (!einst.so_offen) return res.json({ slots: [], grund: 'Geschlossen' });
      vonStr = einst.so_von; bisStr = einst.so_bis;
    } else if (wochentag === 6) {
      if (!einst.sa_offen) return res.json({ slots: [], grund: 'Geschlossen' });
      vonStr = einst.sa_von; bisStr = einst.sa_bis;
    } else {
      vonStr = einst.mo_fr_von || '08:00'; bisStr = einst.mo_fr_bis || '18:00';
    }

    // Mittagspause
    const mpVon = einst.mittagspause_von;
    const mpBis = einst.mittagspause_bis;
    const maxParallel = einst.max_parallele_termine || 1;

    // Bestehende Termine an diesem Tag laden
    const gebuchte = await query(
      `SELECT uhrzeit_von, uhrzeit_bis FROM termine
       WHERE datum=$1 AND status NOT IN ('storniert','abgesagt')`,
      [datum]
    );

    // Alle 15-Min-Slots generieren
    const slots = [];
    const vonMin = zeitZuMin(vonStr);
    const bisMin = zeitZuMin(bisStr);

    for (let start = vonMin; start + dauer <= bisMin; start += 15) {
      const ende = start + dauer;

      // Mittagspause pruefen
      if (mpVon && mpBis) {
        const mpVonMin = zeitZuMin(mpVon);
        const mpBisMin = zeitZuMin(mpBis);
        if (start < mpBisMin && ende > mpVonMin) continue;
      }

      // Ueberschneidungen zaehlen
      const ueberschneidungen = gebuchte.rows.filter(t => {
        const tVon = zeitZuMin(t.uhrzeit_von);
        const tBis = zeitZuMin(t.uhrzeit_bis);
        return start < tBis && ende > tVon;
      }).length;

      if (ueberschneidungen < maxParallel) {
        slots.push({
          von: minZuZeit(start),
          bis: minZuZeit(ende),
          verfuegbar: true
        });
      }
    }

    res.json({ slots, dauer, artikel: artRes.rows[0].name });
  } catch (e) { next(e); }
});

// ── POST /api/portal/daten/termine ──
router.post('/termine', authKunde, async (req, res, next) => {
  try {
    const { datum, uhrzeit_von, artikel_id, beschreibung, kennzeichen, fahrzeug_id, typ, zoll } = req.body;
    if (!datum || !uhrzeit_von || !artikel_id) return res.status(400).json({ error: 'Pflichtfelder fehlen' });

    const artRes = await query('SELECT * FROM artikel WHERE id=$1 AND aktiv=true', [artikel_id]);
    if (!artRes.rows.length) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    const art = artRes.rows[0];
    const varianten = (await query('SELECT * FROM artikel_preise WHERE artikel_id=$1', [artikel_id])).rows;
    const eff = resolvePreis(art, varianten, typ || null, zoll);
    const dauer = eff.dauer_minuten || 30;
    const vonMin = zeitZuMin(uhrzeit_von);
    const uhrzeit_bis = minZuZeit(vonMin + dauer);

    // Nochmal Verfuegbarkeit pruefen (Race Condition verhindern)
    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0];
    const maxParallel = einst ? (einst.max_parallele_termine || 1) : 1;
    const konflikt = await query(
      `SELECT COUNT(*) FROM termine
       WHERE datum=$1 AND status NOT IN ('storniert','abgesagt')
       AND uhrzeit_von < $3 AND uhrzeit_bis > $2`,
      [datum, uhrzeit_von, uhrzeit_bis]
    );
    if (parseInt(konflikt.rows[0].count) >= maxParallel) {
      return res.status(409).json({ error: 'Dieser Termin ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen.' });
    }

    const k = req.kunde;
    const { rows } = await query(
      `INSERT INTO termine (kunden_id, kontakt_name, kontakt_telefon, kontakt_email,
       datum, uhrzeit_von, uhrzeit_bis, termin_typ, kennzeichen, beschreibung,
       artikel_id, fahrzeug_id, status, portal_buchung)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'bestaetigt',true) RETURNING *`,
      [k.id, k.vorname + ' ' + k.nachname, k.telefon, k.portal_email,
       datum, uhrzeit_von, uhrzeit_bis, art.name,
       kennzeichen || k.kennzeichen, beschreibung || null, artikel_id, fahrzeug_id || null]
    );

    // Bestaetigungs-E-Mail an Kunden
    const portalUrl = einst ? (einst.portal_url || '') : '';
    const datumFormatiert = new Date(datum).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    await sendMail(
      k.portal_email,
      'Terminbestätigung — ' + datumFormatiert + ' ' + uhrzeit_von,
      '<p>Hallo ' + k.vorname + ',</p>' +
      '<p>Ihr Termin wurde erfolgreich gebucht:</p>' +
      '<table style="border-collapse:collapse;margin:10px 0"><tr><td style="padding:4px 12px 4px 0;font-weight:700">Datum:</td><td>' + datumFormatiert + '</td></tr>' +
      '<tr><td style="padding:4px 12px 4px 0;font-weight:700">Uhrzeit:</td><td>' + uhrzeit_von + ' Uhr</td></tr>' +
      '<tr><td style="padding:4px 12px 4px 0;font-weight:700">Leistung:</td><td>' + art.name + '</td></tr>' +
      '<tr><td style="padding:4px 12px 4px 0;font-weight:700">Kennzeichen:</td><td>' + (kennzeichen || k.kennzeichen || '') + '</td></tr></table>' +
      '<p>Bei Fragen erreichen Sie uns unter: ' + (einst ? einst.telefon || '' : '') + '</p>' +
      '<p>Stornierung möglich bis ' + (einst ? einst.stornierung_frist_h || 24 : 24) + ' Stunden vorher im Portal.</p>' +
      '<p>Mit freundlichen Grüßen,<br>' + (einst ? einst.firmenname || 'ReifenPro' : 'ReifenPro') + '</p>'
    ).catch(() => {});

    // Benachrichtigung an Admin
    if (einst && einst.email) {
      await sendMail(
        einst.email,
        'Neue Buchung: ' + art.name + ' am ' + datumFormatiert + ' ' + uhrzeit_von,
        '<p><strong>Neue Online-Buchung:</strong></p>' +
        '<p>Kunde: ' + k.vorname + ' ' + k.nachname + '<br>' +
        'Kennzeichen: ' + (kennzeichen || k.kennzeichen || '') + '<br>' +
        'Leistung: ' + art.name + '<br>' +
        'Datum: ' + datumFormatiert + ' ' + uhrzeit_von + ' Uhr</p>'
      ).catch(() => {});
    }

    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

// ── PUT /api/portal/daten/termine/:id ── Termin verschieben (Kunde)
router.put('/termine/:id', authKunde, async (req, res, next) => {
  try {
    const { datum, uhrzeit_von } = req.body;
    if (!datum || !uhrzeit_von) return res.status(400).json({ error: 'Datum und Uhrzeit erforderlich' });
    const t = (await query('SELECT * FROM termine WHERE id=$1 AND kunden_id=$2', [req.params.id, req.kunde.id])).rows[0];
    if (!t) return res.status(404).json({ error: 'Termin nicht gefunden' });
    if (['storniert', 'abgesagt', 'abgeschlossen'].includes(t.status)) return res.status(400).json({ error: 'Dieser Termin kann nicht mehr verschoben werden.' });

    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    const fristH = einst.stornierung_frist_h || 24;
    const terminZeit = new Date(String(t.datum).substring(0, 10) + 'T' + String(t.uhrzeit_von || '00:00:00'));
    if ((terminZeit - new Date()) / 3600000 < fristH) {
      return res.status(400).json({ error: 'Verschieben ist nur bis ' + fristH + ' Stunden vor dem Termin möglich. Bitte rufen Sie uns an: ' + (einst.telefon || '') });
    }

    let dauer = 30;
    if (t.artikel_id) {
      const a = (await query('SELECT * FROM artikel WHERE id=$1', [t.artikel_id])).rows[0];
      if (a) {
        const v = (await query('SELECT * FROM artikel_preise WHERE artikel_id=$1', [t.artikel_id])).rows;
        let typ = null;
        if (t.fahrzeug_id) { const f = (await query('SELECT typ FROM fahrzeuge WHERE id=$1', [t.fahrzeug_id])).rows[0]; if (f) typ = f.typ; }
        dauer = resolvePreis(a, v, typ, null).dauer_minuten || a.dauer_minuten || 30;
      }
    }
    const uhrzeit_bis = minZuZeit(zeitZuMin(uhrzeit_von) + dauer);
    const maxParallel = einst.max_parallele_termine || 1;
    const konflikt = await query(
      `SELECT COUNT(*) FROM termine WHERE datum=$1 AND id<>$2 AND status NOT IN ('storniert','abgesagt')
       AND uhrzeit_von < $4 AND uhrzeit_bis > $3`,
      [datum, t.id, uhrzeit_von, uhrzeit_bis]
    );
    if (parseInt(konflikt.rows[0].count) >= maxParallel) return res.status(409).json({ error: 'Dieser Termin ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen.' });

    const { rows } = await query(
      'UPDATE termine SET datum=$1, uhrzeit_von=$2, uhrzeit_bis=$3, geaendert_am=NOW() WHERE id=$4 RETURNING *',
      [datum, uhrzeit_von, uhrzeit_bis, t.id]
    );
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// ── DELETE /api/portal/daten/termine/:id ──
router.delete('/termine/:id', authKunde, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT * FROM termine WHERE id=$1 AND kunden_id=$2',
      [req.params.id, req.kunde.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Termin nicht gefunden' });
    const t = rows[0];
    if (t.status === 'storniert') return res.status(400).json({ error: 'Termin bereits storniert' });

    // Stornierungsfrist pruefen
    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0];
    const fristH = einst ? (einst.stornierung_frist_h || 24) : 24;
    const terminZeit = new Date(t.datum + 'T' + t.uhrzeit_von);
    const jetzt = new Date();
    const diffH = (terminZeit - jetzt) / 3600000;
    if (diffH < fristH) {
      return res.status(400).json({ error: 'Stornierung nicht mehr möglich. Bitte rufen Sie uns an: ' + (einst ? einst.telefon || '' : '') });
    }

    await query(
      'UPDATE termine SET status=$1, storniert_am=NOW(), storniert_von=$2 WHERE id=$3',
      ['storniert', 'kunde', t.id]
    );

    // E-Mail an Kunden
    const datumF = new Date(t.datum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    await sendMail(
      req.kunde.portal_email,
      'Termin storniert — ' + datumF + ' ' + t.uhrzeit_von,
      '<p>Hallo ' + req.kunde.vorname + ',</p><p>Ihr Termin am ' + datumF + ' um ' + t.uhrzeit_von + ' Uhr wurde erfolgreich storniert.</p>'
    ).catch(() => {});

    // E-Mail an Admin
    if (einst && einst.email) {
      await sendMail(
        einst.email,
        'Stornierung: ' + req.kunde.vorname + ' ' + req.kunde.nachname + ' — ' + datumF,
        '<p>Kunde hat Termin storniert:<br>' + req.kunde.vorname + ' ' + req.kunde.nachname + '<br>' + datumF + ' ' + t.uhrzeit_von + '</p>'
      ).catch(() => {});
    }

    res.json({ message: 'Termin storniert' });
  } catch (e) { next(e); }
});

// ── GET /api/portal/daten/artikel ──
// Buchbare Artikel fuer Portal (nur aktive mit Dauer)
router.get('/artikel', authKunde, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, name, beschreibung, preis, mwst_satz, einheit, dauer_minuten, kategorie FROM artikel WHERE aktiv=true AND dauer_minuten IS NOT NULL ORDER BY sortierung, name'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── GET /api/portal/daten/artikel/:id/preis ── effektiver Preis/Dauer nach Typ+Zoll
router.get('/artikel/:id/preis', authKunde, async (req, res, next) => {
  try {
    const a = (await query('SELECT * FROM artikel WHERE id=$1 AND aktiv=true', [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    const varianten = (await query('SELECT * FROM artikel_preise WHERE artikel_id=$1', [req.params.id])).rows;
    res.json(resolvePreis(a, varianten, req.query.typ || null, req.query.zoll));
  } catch (e) { next(e); }
});

// ── GET /api/portal/daten/oeffnungszeiten ──
router.get('/oeffnungszeiten', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT mo_fr_von, mo_fr_bis, sa_von, sa_bis, sa_offen, so_offen, so_von, so_bis, mittagspause_von, mittagspause_bis FROM einstellungen LIMIT 1');
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});

router.get('/firmendaten', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT firmenname, rechtsform, inhaber, strasse, plz, ort, telefon, email,
       ust_id, handelsreg_nr, registergericht, datenschutz_beauftragter,
       vertragsdauer_monate, abholungsfrist_wochen, lagerungsort, stornierung_frist_h,
       mo_fr_von, mo_fr_bis, sa_von, sa_bis, sa_offen, so_offen, so_von, so_bis
       FROM einstellungen LIMIT 1`
    );
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});

// ── RECHNUNGEN (Kunde sieht eigene) ──
router.get('/rechnungen', authKunde, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, rechnungsnr, to_char(rechnungsdatum,'YYYY-MM-DD') AS rechnungsdatum,
              brutto_summe, status, zahlungsstatus
       FROM rechnungen
       WHERE kunden_id=$1 AND status IN ('festgeschrieben','storniert')
       ORDER BY erstellt_am DESC`,
      [req.kunde.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/rechnungen/:id/pdf', authKunde, async (req, res, next) => {
  try {
    const r = await query('SELECT rechnungsnr, pdf_pfad FROM rechnungen WHERE id=$1 AND kunden_id=$2', [req.params.id, req.kunde.id]);
    if (!r.rows.length || !r.rows[0].pdf_pfad) return res.status(404).json({ error: 'Kein PDF vorhanden' });
    if (!fs.existsSync(r.rows[0].pdf_pfad)) return res.status(404).json({ error: 'PDF-Datei fehlt' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + (r.rows[0].rechnungsnr || 'rechnung') + '.pdf"');
    fs.createReadStream(r.rows[0].pdf_pfad).pipe(res);
  } catch (e) { next(e); }
});

// ── FAHRZEUGE (Kunde pflegt eigene) ──
const FAHRZEUG_TYPEN = ['PKW', 'SUV', 'Transporter', 'Motorrad', 'Sonstiges'];

// Spiegelt das zuletzt gepflegte Fahrzeug in die Kunden-Stammfelder (Suche/Profil/Buchung/HU)
async function syncKundeFz(kundenId, fz) {
  if (!fz) return;
  await query(
    'UPDATE kunden SET kennzeichen=$1, fahrzeug_marke=$2, fahrzeug_modell=$3, hu_datum=COALESCE($4, hu_datum) WHERE id=$5',
    [fz.kennzeichen || null, fz.marke || null, fz.modell || null, fz.hu_datum || null, kundenId]
  );
}

router.get('/fahrzeuge', authKunde, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM fahrzeuge WHERE kunden_id=$1 ORDER BY erstellt_am', [req.kunde.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/fahrzeuge', authKunde, async (req, res, next) => {
  try {
    const { typ, marke, modell, kennzeichen, baujahr, hu_datum, notiz } = req.body;
    if (!marke || !modell || !kennzeichen) return res.status(400).json({ error: 'Kennzeichen, Marke und Modell sind Pflicht.' });
    const t = FAHRZEUG_TYPEN.includes(typ) ? typ : 'PKW';
    const { rows } = await query(
      `INSERT INTO fahrzeuge (kunden_id, typ, marke, modell, kennzeichen, baujahr, hu_datum, notiz)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.kunde.id, t, marke || null, modell || null, kennzeichen ? kennzeichen.toUpperCase() : null, baujahr ? parseInt(baujahr) : null, hu_datum || null, notiz || null]
    );
    await syncKundeFz(req.kunde.id, rows[0]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/fahrzeuge/:id', authKunde, async (req, res, next) => {
  try {
    const { typ, marke, modell, kennzeichen, baujahr, hu_datum, notiz } = req.body;
    if (!marke || !modell || !kennzeichen) return res.status(400).json({ error: 'Kennzeichen, Marke und Modell sind Pflicht.' });
    const t = FAHRZEUG_TYPEN.includes(typ) ? typ : 'PKW';
    const { rows } = await query(
      `UPDATE fahrzeuge SET typ=$1, marke=$2, modell=$3, kennzeichen=$4, baujahr=$5, hu_datum=$6, notiz=$7, geaendert_am=NOW()
       WHERE id=$8 AND kunden_id=$9 RETURNING *`,
      [t, marke || null, modell || null, kennzeichen ? kennzeichen.toUpperCase() : null, baujahr ? parseInt(baujahr) : null, hu_datum || null, notiz || null, req.params.id, req.kunde.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Fahrzeug nicht gefunden' });
    await syncKundeFz(req.kunde.id, rows[0]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/fahrzeuge/:id', authKunde, async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM fahrzeuge WHERE id=$1 AND kunden_id=$2 RETURNING id', [req.params.id, req.kunde.id]);
    if (!rows.length) return res.status(404).json({ error: 'Fahrzeug nicht gefunden' });
    res.json({ message: 'Fahrzeug gelöscht' });
  } catch (e) { next(e); }
});

// ── Hilfsfunktionen ──
function zeitZuMin(zeitStr) {
  if (!zeitStr) return 0;
  const s = String(zeitStr).substring(0, 5);
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}
function minZuZeit(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function isFeiertag(datum) {
  const d = new Date(datum);
  const jahr = d.getFullYear();
  const feiertage = getBayernFeiertage(jahr);
  const key = d.toISOString().substring(0, 10);
  return feiertage.includes(key);
}
function getBayernFeiertage(jahr) {
  // Ostern berechnen (Gauss-Algorithmus)
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d2 = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h2 = (19 * a + b - d2 - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h2 - k) % 7;
  const m2 = Math.floor((a + 11 * h2 + 22 * l) / 451);
  const monat = Math.floor((h2 + l - 7 * m2 + 114) / 31);
  const tag = ((h2 + l - 7 * m2 + 114) % 31) + 1;
  const ostern = new Date(jahr, monat - 1, tag);
  const fmt = (d3) => d3.toISOString().substring(0, 10);
  const add = (d3, t) => { const n = new Date(d3); n.setDate(n.getDate() + t); return fmt(n); };
  return [
    jahr + '-01-01', // Neujahr
    jahr + '-01-06', // Heilige Drei Koenige
    add(ostern, -2),  // Karfreitag
    add(ostern, 1),   // Ostermontag
    jahr + '-05-01', // Tag der Arbeit
    add(ostern, 39),  // Christi Himmelfahrt
    add(ostern, 50),  // Pfingstmontag
    add(ostern, 60),  // Fronleichnam
    jahr + '-08-15', // Maria Himmelfahrt
    jahr + '-10-03', // Tag der Deutschen Einheit
    jahr + '-11-01', // Allerheiligen
    jahr + '-12-25', // 1. Weihnachtstag
    jahr + '-12-26', // 2. Weihnachtstag
  ];
}

async function sendMail(to, subject, html) {
  const nodemailer = require('nodemailer');
  const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: '"' + (einst.firmenname || 'ReifenPro') + '" <' + process.env.SMTP_USER + '>',
    to, subject, html
  });
}

module.exports = router;
