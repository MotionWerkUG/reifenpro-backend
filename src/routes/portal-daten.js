'use strict';
const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../db/index');
const { authKunde } = require('./portal-auth');
const { resolvePreis } = require('../lib/preis');
const oeffnung = require('../lib/oeffnung');
const { kundenMailHtml } = require('../lib/mail-template');
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
    if (!datum || !artikel_id || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return res.status(400).json({ error: 'Gültiges datum (YYYY-MM-DD) und artikel_id erforderlich' });

    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0];
    if (!einst) return res.status(500).json({ error: 'Einstellungen fehlen' });

    // Artikel + Preisstaffel laden, effektive Dauer nach Typ/Zoll ermitteln
    const artRes = await query('SELECT * FROM artikel WHERE id=$1 AND aktiv=true', [artikel_id]);
    if (!artRes.rows.length) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    const varianten = (await query('SELECT * FROM artikel_preise WHERE artikel_id=$1', [artikel_id])).rows;
    const eff = resolvePreis(artRes.rows[0], varianten, req.query.typ || null, req.query.zoll);
    const dauer = eff.dauer_minuten || 30;

    // Betriebsurlaub pruefen
    const urlaub = await query(
      'SELECT id FROM betriebsurlaub WHERE von_datum <= $1 AND bis_datum >= $1',
      [datum]
    );
    if (urlaub.rows.length) return res.json({ slots: [], grund: 'Betriebsurlaub' });

    // Neues Modell: besondere Tage (Feiertag/Urlaub) ueberschreiben die regulaere Woche; 1-2 Spannen/Tag.
    // (Fixt zugleich den frueheren kaputten Feiertag-Check, der ein Date-Objekt an einen String-Matcher gab.)
    const off = await oeffnung.oeffnungFuerTag(datum);
    if (off.geschlossen) {
      const bt = (await query('SELECT bezeichnung FROM besondere_tage WHERE datum=$1 AND geschlossen=true', [datum])).rows[0];
      return res.json({ slots: [], grund: (bt && bt.bezeichnung) ? bt.bezeichnung : 'Geschlossen' });
    }
    const maxParallel = einst.max_parallele_termine || 1;

    // Bestehende Termine an diesem Tag laden
    const gebuchte = await query(
      `SELECT uhrzeit_von, uhrzeit_bis FROM termine
       WHERE datum=$1 AND status NOT IN ('storniert','abgesagt')`,
      [datum]
    );

    // 15-Min-Slots je Oeffnungsspanne (Mittagspause = Luecke zwischen den Spannen)
    const slots = [];
    for (const sp of off.spannen) {
      const vonMin = zeitZuMin(sp[0]);
      const bisMin = zeitZuMin(sp[1]);
      for (let start = vonMin; start + dauer <= bisMin; start += 15) {
        const ende = start + dauer;
        const ueberschneidungen = gebuchte.rows.filter(t => {
          const tVon = zeitZuMin(t.uhrzeit_von);
          const tBis = zeitZuMin(t.uhrzeit_bis);
          return start < tBis && ende > tVon;
        }).length;
        if (ueberschneidungen < maxParallel) {
          slots.push({ von: minZuZeit(start), bis: minZuZeit(ende), verfuegbar: true });
        }
      }
    }

    res.json({ slots, dauer, artikel: artRes.rows[0].name });
  } catch (e) { next(e); }
});

// ── POST /api/portal/daten/termine ──
router.post('/termine', authKunde, async (req, res, next) => {
  try {
    const { datum, uhrzeit_von, artikel_id, beschreibung, kennzeichen, fahrzeug_id, typ, zoll } = req.body;
    if (!datum || !uhrzeit_von || !artikel_id || !/^\d{4}-\d{2}-\d{2}$/.test(datum) || !/^\d{2}:\d{2}/.test(uhrzeit_von)) return res.status(400).json({ error: 'Pflichtfelder fehlen oder ungültiges Datum/Uhrzeit' });

    const artRes = await query('SELECT * FROM artikel WHERE id=$1 AND aktiv=true', [artikel_id]);
    if (!artRes.rows.length) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    const art = artRes.rows[0];
    const varianten = (await query('SELECT * FROM artikel_preise WHERE artikel_id=$1', [artikel_id])).rows;
    const eff = resolvePreis(art, varianten, typ || null, zoll);
    const dauer = eff.dauer_minuten || 30;
    const vonMin = zeitZuMin(uhrzeit_von);
    const uhrzeit_bis = minZuZeit(vonMin + dauer);

    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0];
    const maxParallel = einst ? (einst.max_parallele_termine || 1) : 1;
    const k = req.kunde;

    // Datum/Uhrzeit serverseitig validieren (wie bei der Gastbuchung) — sonst per direktem Request umgehbar.
    const heuteStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    if (datum < heuteStr) return res.status(400).json({ error: 'Das gewählte Datum liegt in der Vergangenheit.' });
    const _bu = await query('SELECT 1 FROM betriebsurlaub WHERE von_datum <= $1 AND bis_datum >= $1', [datum]);
    if (_bu.rows.length) return res.status(409).json({ error: 'An diesem Tag ist keine Buchung möglich (Betriebsurlaub).' });
    // Neues Modell: besondere Tage (Feiertag/Urlaub) ueberschreiben die Woche; Slot muss in eine Spanne fallen.
    const _off = await oeffnung.oeffnungFuerTag(datum);
    if (_off.geschlossen) {
      const _bt = (await query('SELECT bezeichnung FROM besondere_tage WHERE datum=$1 AND geschlossen=true', [datum])).rows[0];
      return res.status(409).json({ error: 'An diesem Tag ist keine Buchung möglich (' + ((_bt && _bt.bezeichnung) ? _bt.bezeichnung : 'geschlossen') + ').' });
    }
    const _imFenster = (_off.spannen || []).some(sp => vonMin >= zeitZuMin(sp[0]) && (vonMin + dauer) <= zeitZuMin(sp[1]));
    if (!_imFenster) return res.status(400).json({ error: 'Die gewählte Uhrzeit liegt außerhalb der Öffnungszeiten.' });
    if (datum === heuteStr) {
      const _jetzt = zeitZuMin(new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }));
      if (vonMin <= _jetzt) return res.status(400).json({ error: 'Die gewählte Uhrzeit liegt in der Vergangenheit.' });
    }

    // ── Sammeltermin (nur Gewerbekunden, mehrere Fahrzeuge) ──
    // Wird NICHT sofort bestaetigt: Status 'angefragt', der Admin terminiert/bestaetigt.
    const istSammel = k.ist_gewerbe && req.body.sammeltermin === true && Array.isArray(req.body.fahrzeug_ids) && req.body.fahrzeug_ids.length > 0;
    if (istSammel) {
      const fzs = (await query('SELECT id, typ, marke, modell, kennzeichen FROM fahrzeuge WHERE kunden_id=$1 AND id = ANY($2::uuid[])', [k.id, req.body.fahrzeug_ids])).rows;
      if (!fzs.length) return res.status(400).json({ error: 'Keine gültigen Fahrzeuge ausgewählt.' });
      const liste = fzs.map((f) => [f.marke, f.modell, f.kennzeichen].filter(Boolean).join(' ')).join('; ');
      const besch = 'Sammeltermin-Anfrage (' + fzs.length + ' Fahrzeuge): ' + liste + (beschreibung ? ' | ' + beschreibung : '');
      const kzListe = fzs.map((f) => f.kennzeichen).filter(Boolean).join(', ') || null;
      const ins = await query(
        `INSERT INTO termine (kunden_id, kontakt_name, kontakt_telefon, kontakt_email,
         datum, uhrzeit_von, uhrzeit_bis, termin_typ, kennzeichen, beschreibung, artikel_id, status, portal_buchung)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'angefragt',true) RETURNING *`,
        [k.id, k.vorname + ' ' + k.nachname, k.telefon, k.portal_email,
         datum, uhrzeit_von, uhrzeit_bis, art.name, kzListe, besch, artikel_id]);
      const datumF = new Date(datum + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
      await sendMail(k.portal_email, 'Sammelterminanfrage eingegangen — ' + datumF,
        '<p>Hallo ' + k.vorname + ',</p>' +
        '<p>vielen Dank für Ihre Sammelterminanfrage für ' + fzs.length + ' Fahrzeuge (' + art.name + ').</p>' +
        '<p><strong>Wunschtermin:</strong> ' + datumF + ' ab ' + uhrzeit_von + ' Uhr</p>' +
        '<p>Wir prüfen die Verfügbarkeit und bestätigen Ihnen den Termin in Kürze. Bei Rückfragen erreichen Sie uns unter ' + (einst ? einst.telefon || '' : '') + '.</p>' +
        '<p>Mit freundlichen Grüßen,<br>' + (einst ? einst.firmenname || 'ReifenPro' : 'ReifenPro') + '</p>').catch(() => {});
      if (einst && einst.email) {
        await sendMail(einst.email, 'Sammelterminanfrage: ' + fzs.length + ' Fahrzeuge am ' + datumF,
          '<p><strong>Neue Sammelterminanfrage (Gewerbekunde):</strong></p>' +
          '<p>Kunde: ' + k.vorname + ' ' + k.nachname + '<br>Leistung: ' + art.name + '<br>Wunschtermin: ' + datumF + ' ' + uhrzeit_von + ' Uhr</p>' +
          '<p>Fahrzeuge:<br>' + fzs.map((f) => [f.marke, f.modell, f.kennzeichen].filter(Boolean).join(' ')).join('<br>') + '</p>' +
          '<p>Status: angefragt — bitte im Kalender terminieren und bestätigen.</p>').catch(() => {});
      }
      return res.status(201).json(ins.rows[0]);
    }

    // Eigentumspruefung: fremde/unbekannte fahrzeug_id nicht an den Termin haengen (IDOR-Schutz).
    // Nicht-UUID-Werte vorab verwerfen, sonst wirft die uuid-Spalte einen 500er statt sauber null.
    let fzId = fahrzeug_id || null;
    if (fzId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(fzId))) {
        fzId = null;
      } else {
        const own = await query('SELECT 1 FROM fahrzeuge WHERE id=$1 AND kunden_id=$2', [fzId, k.id]);
        if (!own.rows.length) fzId = null;
      }
    }

    // Verfuegbarkeitspruefung + Insert in einer Transaktion mit Advisory-Lock je Tag
    // -> verhindert Doppelbuchung desselben Slots bei gleichzeitigen Anfragen (TOCTOU).
    const rows = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['termin:' + datum]);
      const konflikt = await client.query(
        `SELECT COUNT(*) FROM termine
         WHERE datum=$1 AND status NOT IN ('storniert','abgesagt')
         AND uhrzeit_von < $3 AND uhrzeit_bis > $2`,
        [datum, uhrzeit_von, uhrzeit_bis]);
      if (parseInt(konflikt.rows[0].count) >= maxParallel) {
        const e = new Error('Dieser Termin ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen.'); e.status = 409; throw e;
      }
      const ins = await client.query(
        `INSERT INTO termine (kunden_id, kontakt_name, kontakt_telefon, kontakt_email,
         datum, uhrzeit_von, uhrzeit_bis, termin_typ, kennzeichen, beschreibung,
         artikel_id, fahrzeug_id, status, portal_buchung)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'bestaetigt',true) RETURNING *`,
        [k.id, k.vorname + ' ' + k.nachname, k.telefon, k.portal_email,
         datum, uhrzeit_von, uhrzeit_bis, art.name,
         kennzeichen || k.kennzeichen, beschreibung || null, artikel_id, fzId]);
      return ins.rows;
    });

    // Bestaetigungs-E-Mail an Kunden
    const portalUrl = einst ? (einst.portal_url || '') : '';
    const datumFormatiert = new Date(datum).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const htmlBestaetigung = kundenMailHtml(einst || {}, {
      anrede: k.anrede, vorname: k.vorname, nachname: k.nachname,
      titel: 'Terminbestätigung',
      text: (einst && einst.email_termin_bestaetigung) || 'wir bestätigen Ihren Termin am {datum} um {uhrzeit} Uhr ({leistung}, {kennzeichen}).',
      vars: {
        vorname: k.vorname || '', nachname: k.nachname || '', kennzeichen: kennzeichen || k.kennzeichen || '',
        datum: datumFormatiert, uhrzeit: uhrzeit_von, leistung: art.name,
        stornofrist: (einst && einst.stornierung_frist_h) || 24, portal_url: (einst && einst.portal_url) || '',
        telefon: (einst && einst.telefon) || '', firmenname: (einst && einst.firmenname) || 'Schröder & Scholz'
      }
    });
    await sendMail(k.portal_email, 'Terminbestätigung — ' + datumFormatiert + ' ' + uhrzeit_von, htmlBestaetigung).catch(() => {});

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
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

// ── PUT /api/portal/daten/termine/:id ── Termin verschieben (Kunde)
router.put('/termine/:id', authKunde, async (req, res, next) => {
  try {
    const { datum, uhrzeit_von } = req.body;
    if (!datum || !uhrzeit_von || !/^\d{4}-\d{2}-\d{2}$/.test(datum) || !/^\d{2}:\d{2}/.test(uhrzeit_von)) return res.status(400).json({ error: 'Gültiges Datum und Uhrzeit erforderlich' });
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

    // NEUES Datum/Uhrzeit wie bei der Neubuchung validieren — sonst umgeht Verschieben
    // Öffnungszeiten/Feiertage/Betriebsurlaub/Vergangenheit komplett (Buchung -> Feiertag/Pause/Vergangenheit).
    const heuteStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    if (datum < heuteStr) return res.status(400).json({ error: 'Das gewählte Datum liegt in der Vergangenheit.' });
    if (datum === heuteStr) {
      const jetzt = zeitZuMin(new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }));
      if (zeitZuMin(uhrzeit_von) <= jetzt) return res.status(400).json({ error: 'Die gewählte Uhrzeit liegt in der Vergangenheit.' });
    }
    const _bu = await query('SELECT 1 FROM betriebsurlaub WHERE von_datum <= $1 AND bis_datum >= $1', [datum]);
    if (_bu.rows.length) return res.status(409).json({ error: 'An diesem Tag ist keine Buchung möglich (Betriebsurlaub).' });
    const _off = await oeffnung.oeffnungFuerTag(datum);
    if (_off.geschlossen) {
      const _bt = (await query('SELECT bezeichnung FROM besondere_tage WHERE datum=$1 AND geschlossen=true', [datum])).rows[0];
      return res.status(409).json({ error: 'An diesem Tag ist keine Buchung möglich (' + ((_bt && _bt.bezeichnung) ? _bt.bezeichnung : 'geschlossen') + ').' });
    }
    const _vonMin = zeitZuMin(uhrzeit_von);
    const _imFenster = (_off.spannen || []).some(sp => _vonMin >= zeitZuMin(sp[0]) && (_vonMin + dauer) <= zeitZuMin(sp[1]));
    if (!_imFenster) return res.status(400).json({ error: 'Die gewählte Uhrzeit liegt außerhalb der Öffnungszeiten.' });

    // Konfliktpruefung + Update unter Advisory-Lock je Tag -> gleiche Race-Absicherung wie beim Buchen
    const updated = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['termin:' + datum]);
      const konflikt = await client.query(
        `SELECT COUNT(*) FROM termine WHERE datum=$1 AND id<>$2 AND status NOT IN ('storniert','abgesagt')
         AND uhrzeit_von < $4 AND uhrzeit_bis > $3`,
        [datum, t.id, uhrzeit_von, uhrzeit_bis]);
      if (parseInt(konflikt.rows[0].count) >= maxParallel) { const e = new Error('Dieser Termin ist leider nicht mehr verfügbar. Bitte wählen Sie einen anderen.'); e.status = 409; throw e; }
      const r = await client.query(
        'UPDATE termine SET datum=$1, uhrzeit_von=$2, uhrzeit_bis=$3, geaendert_am=NOW() WHERE id=$4 RETURNING *',
        [datum, uhrzeit_von, uhrzeit_bis, t.id]);
      return r.rows[0];
    });
    res.json(updated);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
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
    const htmlStorno = kundenMailHtml(einst || {}, {
      anrede: req.kunde.anrede, vorname: req.kunde.vorname, nachname: req.kunde.nachname,
      titel: 'Termin storniert',
      text: (einst && einst.email_termin_stornierung) || 'hiermit bestätigen wir die Stornierung Ihres Termins am {datum} um {uhrzeit} Uhr. Es entstehen Ihnen keine Kosten.',
      vars: {
        vorname: req.kunde.vorname || '', datum: datumF, uhrzeit: (t.uhrzeit_von || '').substring(0, 5), leistung: '',
        portal_url: (einst && einst.portal_url) || '', telefon: (einst && einst.telefon) || '',
        firmenname: (einst && einst.firmenname) || 'Schröder & Scholz'
      }
    });
    await sendMail(req.kunde.portal_email, 'Ihr Termin am ' + datumF + ' wurde storniert', htmlStorno).catch(() => {});

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
    // Aktuelle Bereifung je Fahrzeug aus den Einlagerungen (Fuhrpark-Uebersicht)
    const einl = (await query(
      `SELECT id, fahrzeug_id, reifen_typ, reifen_groesse, reifen_marke, reifen_modell, status, lagerplatz, eingelagert_am
       FROM einlagerungen WHERE kunden_id=$1 ORDER BY eingelagert_am DESC`, [req.kunde.id])).rows;
    rows.forEach((f) => { f.raeder = einl.filter((e) => e.fahrzeug_id === f.id); });
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/fahrzeuge', authKunde, async (req, res, next) => {
  try {
    const { typ, baujahr, hu_datum } = req.body;
    // Freitext von HTML-Zeichen befreien (landet unescaped in Werkstatt-/Bestaetigungs-/HU-Mails) + Laengen-Cap.
    const clean = (s, n) => s == null ? null : String(s).replace(/[<>]/g, '').slice(0, n);
    const marke = clean(req.body.marke, 60), modell = clean(req.body.modell, 60);
    const kennzeichen = req.body.kennzeichen ? clean(req.body.kennzeichen, 20).toUpperCase() : null;
    const notiz = clean(req.body.notiz, 500);
    if (!marke || !modell || !kennzeichen) return res.status(400).json({ error: 'Kennzeichen, Marke und Modell sind Pflicht.' });
    const t = FAHRZEUG_TYPEN.includes(typ) ? typ : 'PKW';
    const { rows } = await query(
      `INSERT INTO fahrzeuge (kunden_id, typ, marke, modell, kennzeichen, baujahr, hu_datum, notiz)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.kunde.id, t, marke, modell, kennzeichen, baujahr ? parseInt(baujahr) : null, hu_datum || null, notiz]
    );
    await syncKundeFz(req.kunde.id, rows[0]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.put('/fahrzeuge/:id', authKunde, async (req, res, next) => {
  try {
    const { typ, baujahr, hu_datum } = req.body;
    // Freitext von HTML-Zeichen befreien (Mails) + Laengen-Cap.
    const clean = (s, n) => s == null ? null : String(s).replace(/[<>]/g, '').slice(0, n);
    const marke = clean(req.body.marke, 60), modell = clean(req.body.modell, 60);
    const kennzeichen = req.body.kennzeichen ? clean(req.body.kennzeichen, 20).toUpperCase() : null;
    const notiz = clean(req.body.notiz, 500);
    if (!marke || !modell || !kennzeichen) return res.status(400).json({ error: 'Kennzeichen, Marke und Modell sind Pflicht.' });
    const t = FAHRZEUG_TYPEN.includes(typ) ? typ : 'PKW';
    const { rows } = await query(
      `UPDATE fahrzeuge SET typ=$1, marke=$2, modell=$3, kennzeichen=$4, baujahr=$5, hu_datum=$6, notiz=$7, geaendert_am=NOW()
       WHERE id=$8 AND kunden_id=$9 RETURNING *`,
      [t, marke, modell, kennzeichen, baujahr ? parseInt(baujahr) : null, hu_datum || null, notiz, req.params.id, req.kunde.id]
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
