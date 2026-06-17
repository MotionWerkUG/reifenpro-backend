'use strict';
const router = require('express').Router();
const fs = require('fs');
const { query, withTransaction } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const { erzeugeRechnungPdf } = require('../lib/rechnung-pdf');
const { resolvePreis } = require('../lib/preis');
const { portalMailHtml } = require('../lib/mail-template');

router.use(authenticate, requireStaff);

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Summen + normalisierte Positionen serverseitig berechnen (Client-Werte werden NICHT vertraut)
function berechneSummen(positionen) {
  let netto = 0, brutto = 0;
  const proSatz = {};
  const norm = (positionen || []).map(function (p, i) {
    const menge = Number(p.menge) || 0;
    const ep = Number(p.einzelpreis_netto) || 0;
    const satz = Number(p.mwst_satz);
    const mwst = Number.isFinite(satz) ? satz : 19;
    const zNetto = round2(menge * ep);
    const zBrutto = round2(zNetto * (1 + mwst / 100));
    netto = round2(netto + zNetto);
    brutto = round2(brutto + zBrutto);
    if (!proSatz[mwst]) proSatz[mwst] = { satz: mwst, netto: 0, mwst: 0 };
    proSatz[mwst].netto = round2(proSatz[mwst].netto + zNetto);
    proSatz[mwst].mwst = round2(proSatz[mwst].mwst + (zBrutto - zNetto));
    return {
      position: i + 1,
      bezeichnung: (p.bezeichnung || '').toString().trim(),
      menge: menge,
      einheit: p.einheit || null,
      einzelpreis_netto: ep,
      mwst_satz: mwst,
      zeilen_netto: zNetto,
      zeilen_brutto: zBrutto,
      artikel_id: p.artikel_id || null
    };
  });
  return {
    positionen: norm,
    netto_summe: netto,
    mwst_summe: round2(brutto - netto),
    brutto_summe: brutto,
    mwst_aufschluesselung: Object.keys(proSatz).map(function (k) { return proSatz[k]; })
  };
}

const LEER_EMPF = {
  empfaenger_anrede: null, empfaenger_vorname: null, empfaenger_nachname: null,
  empfaenger_name: null, empfaenger_firma: null, empfaenger_strasse: null, empfaenger_plz: null, empfaenger_ort: null
};

async function ladeEmpfaenger(kunden_id) {
  if (!kunden_id) return Object.assign({}, LEER_EMPF);
  const { rows } = await query('SELECT anrede,vorname,nachname,firma,strasse,plz,ort FROM kunden WHERE id=$1', [kunden_id]);
  if (!rows.length) return Object.assign({}, LEER_EMPF);
  const k = rows[0];
  return {
    empfaenger_anrede: k.anrede || null,
    empfaenger_vorname: k.vorname || null,
    empfaenger_nachname: k.nachname || null,
    empfaenger_name: ((k.vorname || '') + ' ' + (k.nachname || '')).trim() || null,
    empfaenger_firma: k.firma || null,
    empfaenger_strasse: k.strasse || null,
    empfaenger_plz: k.plz || null,
    empfaenger_ort: k.ort || null
  };
}

// Empfaenger-Snapshot aus dem Client-Body (manuell eintragbar, NICHT aus dem Kundenstamm gezogen).
// Liefert null, wenn keine Empfaengerangaben mitgegeben wurden (dann greift der kunden_id-Fallback).
function empfaengerAusBody(body) {
  const e = (body && body.empfaenger) || null;
  if (!e) return null;
  const s = (v) => (v == null ? null : String(v).trim() || null);
  const vorname = s(e.vorname), nachname = s(e.nachname), firma = s(e.firma);
  const name = ((vorname || '') + ' ' + (nachname || '')).trim() || null;
  return {
    empfaenger_anrede: s(e.anrede),
    empfaenger_vorname: vorname,
    empfaenger_nachname: nachname,
    empfaenger_name: name,
    empfaenger_firma: firma,
    empfaenger_strasse: s(e.strasse),
    empfaenger_plz: s(e.plz),
    empfaenger_ort: s(e.ort)
  };
}

function ausstellerSnapshot(einst) {
  const e = einst || {};
  return {
    firmenname: e.firmenname, inhaber: e.inhaber, rechtsform: e.rechtsform,
    strasse: e.strasse, plz: e.plz, ort: e.ort, telefon: e.telefon, email: e.email,
    ust_id: e.ust_id, steuernummer: e.steuernummer,
    handelsreg_nr: e.handelsreg_nr, registergericht: e.registergericht,
    bank: e.bank, iban: e.iban, bic: e.bic
  };
}

async function insertPositionen(client, rechnungId, positionen) {
  for (const p of positionen) {
    await client.query(
      `INSERT INTO rechnung_positionen
         (rechnung_id, position, bezeichnung, menge, einheit, einzelpreis_netto, mwst_satz, zeilen_netto, zeilen_brutto, artikel_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [rechnungId, p.position, p.bezeichnung, p.menge, p.einheit, p.einzelpreis_netto, p.mwst_satz, p.zeilen_netto, p.zeilen_brutto, p.artikel_id]
    );
  }
}

function heute() { return new Date().toISOString().substring(0, 10); }

// ── GET / ── Liste
router.get('/', async (req, res, next) => {
  try {
    const { jahr, status, kunden_id } = req.query;
    let sql = `SELECT r.*, k.vorname || ' ' || k.nachname AS kundenname, k.kunden_nr
               FROM rechnungen r LEFT JOIN kunden k ON k.id = r.kunden_id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); sql += ` AND r.status = $${params.length}`; }
    if (kunden_id) { params.push(kunden_id); sql += ` AND r.kunden_id = $${params.length}`; }
    if (jahr) { params.push(parseInt(jahr)); sql += ` AND EXTRACT(YEAR FROM r.rechnungsdatum) = $${params.length}`; }
    sql += ' ORDER BY r.erstellt_am DESC';
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) { next(e); }
});

// ── GET /statistik ── Umsatz + offene Posten (muss vor /:id stehen)
router.get('/statistik', async (req, res, next) => {
  try {
    const jahr = parseInt(req.query.jahr) || new Date().getFullYear();
    const { rows } = await query(
      `SELECT
         COALESCE(SUM(brutto_summe),0) AS umsatz_brutto,
         COALESCE(SUM(netto_summe),0)  AS umsatz_netto,
         COUNT(*) AS anzahl,
         COALESCE(SUM(brutto_summe) FILTER (WHERE zahlungsstatus='offen'),0) AS offen_summe,
         COUNT(*) FILTER (WHERE zahlungsstatus='offen') AS offen_anzahl,
         COALESCE(SUM(brutto_summe) FILTER (WHERE zahlungsstatus='offen' AND faelligkeit < CURRENT_DATE),0) AS ueberfaellig_summe,
         COUNT(*) FILTER (WHERE zahlungsstatus='offen' AND faelligkeit < CURRENT_DATE) AS ueberfaellig_anzahl
       FROM rechnungen
       WHERE status='festgeschrieben' AND storno_von_id IS NULL AND EXTRACT(YEAR FROM rechnungsdatum)=$1`,
      [jahr]
    );
    res.json(Object.assign({ jahr: jahr }, rows[0]));
  } catch (e) { next(e); }
});

// ── GET /:id ── Detail inkl. Positionen
router.get('/:id', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT r.*, k.vorname || ' ' || k.nachname AS kundenname, k.kunden_nr
       FROM rechnungen r LEFT JOIN kunden k ON k.id = r.kunden_id WHERE r.id = $1`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    const pos = await query('SELECT * FROM rechnung_positionen WHERE rechnung_id=$1 ORDER BY position', [req.params.id]);
    res.json(Object.assign({}, r.rows[0], { positionen: pos.rows }));
  } catch (e) { next(e); }
});

// ── POST / ── Entwurf anlegen
router.post('/', async (req, res, next) => {
  try {
    const { kunden_id, rechnungsdatum, leistungsdatum, notizen, positionen } = req.body;
    if (!positionen || !positionen.length) return res.status(400).json({ error: 'Mindestens eine Position erforderlich.' });
    // Empfaenger: explizite Eingabe (Snapshot) bevorzugen, sonst aus Kundenstamm laden
    const emp = empfaengerAusBody(req.body) || await ladeEmpfaenger(kunden_id || null);
    if (!emp.empfaenger_name && !emp.empfaenger_firma && !kunden_id) {
      return res.status(400).json({ error: 'Bitte einen Kunden wählen oder einen Empfänger (Name oder Firma) eintragen.' });
    }
    const s = berechneSummen(positionen);
    const rdatum = rechnungsdatum || heute();
    const ldatum = leistungsdatum || rdatum;
    const result = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO rechnungen
           (status, kunden_id, empfaenger_anrede, empfaenger_vorname, empfaenger_nachname, empfaenger_name, empfaenger_firma, empfaenger_strasse, empfaenger_plz, empfaenger_ort,
            rechnungsdatum, leistungsdatum, netto_summe, mwst_summe, brutto_summe, mwst_aufschluesselung, notizen, erstellt_von)
         VALUES ('entwurf',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [kunden_id || null, emp.empfaenger_anrede, emp.empfaenger_vorname, emp.empfaenger_nachname, emp.empfaenger_name, emp.empfaenger_firma, emp.empfaenger_strasse, emp.empfaenger_plz, emp.empfaenger_ort,
         rdatum, ldatum, s.netto_summe, s.mwst_summe, s.brutto_summe, JSON.stringify(s.mwst_aufschluesselung), notizen || null, req.user.id]
      );
      await insertPositionen(client, ins.rows[0].id, s.positionen);
      return ins.rows[0];
    });
    await auditLog({ userId: req.user.id, aktion: 'rechnung.entwurf', tabelle: 'rechnungen', datensatzId: result.id, req });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

// ── POST /aus-termin/:terminId ── Entwurf aus erledigtem Termin (Leistung + Staffelpreis)
router.post('/aus-termin/:terminId', async (req, res, next) => {
  try {
    const t = (await query(
      `SELECT t.*, a.id AS aid, a.name AS artikel_name, a.einheit AS artikel_einheit, a.preis AS artikel_preis, a.mwst_satz AS artikel_mwst
       FROM termine t LEFT JOIN artikel a ON a.id = t.artikel_id WHERE t.id = $1`,
      [req.params.terminId]
    )).rows[0];
    if (!t) return res.status(404).json({ error: 'Termin nicht gefunden.' });
    if (!t.kunden_id) return res.status(400).json({ error: 'Termin ohne Kundenkonto — Rechnung bitte manuell anlegen.' });

    let typ = null;
    if (t.fahrzeug_id) {
      const f = (await query('SELECT typ FROM fahrzeuge WHERE id=$1', [t.fahrzeug_id])).rows[0];
      if (f) typ = f.typ;
    }
    let preis = t.artikel_preis != null ? Number(t.artikel_preis) : 0;
    let mwst = t.artikel_mwst != null ? Number(t.artikel_mwst) : 19;
    if (t.aid) {
      const a = (await query('SELECT * FROM artikel WHERE id=$1', [t.aid])).rows[0];
      const varianten = (await query('SELECT * FROM artikel_preise WHERE artikel_id=$1', [t.aid])).rows;
      const eff = resolvePreis(a, varianten, typ, null);
      preis = Number(eff.preis) || 0;
      mwst = eff.mwst_satz != null ? Number(eff.mwst_satz) : 19;
    }
    // Gewerbe-Konditionen: fester Kundenpreis -> sonst Pauschalrabatt -> sonst Standard
    if (t.kunden_id && t.aid) {
      const kp = (await query('SELECT preis FROM kunden_preise WHERE kunden_id=$1 AND artikel_id=$2', [t.kunden_id, t.aid])).rows[0];
      if (kp) { preis = Number(kp.preis); }
      else {
        const kr = (await query('SELECT grosskunden_rabatt FROM kunden WHERE id=$1', [t.kunden_id])).rows[0];
        if (kr && kr.grosskunden_rabatt > 0) preis = round2(preis * (1 - kr.grosskunden_rabatt / 100));
      }
    }
    const bez = (t.artikel_name || t.termin_typ || 'Leistung') + (t.kennzeichen ? ' — ' + t.kennzeichen : '');
    const s = berechneSummen([{ bezeichnung: bez, menge: 1, einheit: t.artikel_einheit || null, einzelpreis_netto: preis, mwst_satz: mwst, artikel_id: t.aid || null }]);
    const emp = await ladeEmpfaenger(t.kunden_id);
    const rdatum = heute();
    const result = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO rechnungen
           (status, kunden_id, empfaenger_anrede, empfaenger_vorname, empfaenger_nachname, empfaenger_name, empfaenger_firma, empfaenger_strasse, empfaenger_plz, empfaenger_ort,
            rechnungsdatum, leistungsdatum, netto_summe, mwst_summe, brutto_summe, mwst_aufschluesselung, notizen, erstellt_von)
         VALUES ('entwurf',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [t.kunden_id, emp.empfaenger_anrede, emp.empfaenger_vorname, emp.empfaenger_nachname, emp.empfaenger_name, emp.empfaenger_firma, emp.empfaenger_strasse, emp.empfaenger_plz, emp.empfaenger_ort,
         rdatum, t.datum || rdatum, s.netto_summe, s.mwst_summe, s.brutto_summe, JSON.stringify(s.mwst_aufschluesselung), 'Aus Termin vom ' + (t.datum || ''), req.user.id]
      );
      await insertPositionen(client, ins.rows[0].id, s.positionen);
      return ins.rows[0];
    });
    await auditLog({ userId: req.user.id, aktion: 'rechnung.aus_termin', tabelle: 'rechnungen', datensatzId: result.id, req });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

// ── PUT /:id ── Entwurf aendern (nur Entwurf)
router.put('/:id', async (req, res, next) => {
  try {
    const cur = await query('SELECT * FROM rechnungen WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (cur.rows[0].status !== 'entwurf') return res.status(400).json({ error: 'Nur Entwuerfe koennen bearbeitet werden.' });
    const { kunden_id, rechnungsdatum, leistungsdatum, notizen, positionen } = req.body;
    if (!positionen || !positionen.length) return res.status(400).json({ error: 'Mindestens eine Position erforderlich.' });
    // kunden_id ist explizit setzbar (auch auf null); fehlt das Feld ganz, bleibt die bisherige Verknuepfung
    const kid = (kunden_id !== undefined) ? (kunden_id || null) : cur.rows[0].kunden_id;
    const s = berechneSummen(positionen);
    // Empfaenger: explizite Eingabe (Snapshot) bevorzugen, sonst aus Kundenstamm laden
    const emp = empfaengerAusBody(req.body) || await ladeEmpfaenger(kid);
    if (!emp.empfaenger_name && !emp.empfaenger_firma && !kid) {
      return res.status(400).json({ error: 'Bitte einen Kunden wählen oder einen Empfänger (Name oder Firma) eintragen.' });
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE rechnungen SET kunden_id=$1, empfaenger_anrede=$2, empfaenger_vorname=$3, empfaenger_nachname=$4,
           empfaenger_name=$5, empfaenger_firma=$6, empfaenger_strasse=$7, empfaenger_plz=$8, empfaenger_ort=$9,
           rechnungsdatum=$10, leistungsdatum=$11,
           netto_summe=$12, mwst_summe=$13, brutto_summe=$14, mwst_aufschluesselung=$15, notizen=$16
         WHERE id=$17`,
        [kid, emp.empfaenger_anrede, emp.empfaenger_vorname, emp.empfaenger_nachname, emp.empfaenger_name, emp.empfaenger_firma, emp.empfaenger_strasse, emp.empfaenger_plz, emp.empfaenger_ort,
         rechnungsdatum || cur.rows[0].rechnungsdatum, leistungsdatum || cur.rows[0].leistungsdatum,
         s.netto_summe, s.mwst_summe, s.brutto_summe, JSON.stringify(s.mwst_aufschluesselung), notizen || null, req.params.id]
      );
      await client.query('DELETE FROM rechnung_positionen WHERE rechnung_id=$1', [req.params.id]);
      await insertPositionen(client, req.params.id, s.positionen);
    });
    const out = await query('SELECT * FROM rechnungen WHERE id=$1', [req.params.id]);
    res.json(out.rows[0]);
  } catch (e) { next(e); }
});

// ── DELETE /:id ── Entwurf loeschen (nur Entwurf)
router.delete('/:id', async (req, res, next) => {
  try {
    const cur = await query('SELECT status FROM rechnungen WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (cur.rows[0].status !== 'entwurf') return res.status(400).json({ error: 'Nur Entwuerfe koennen geloescht werden.' });
    await query('DELETE FROM rechnungen WHERE id=$1', [req.params.id]); // Positionen via ON DELETE CASCADE
    await auditLog({ userId: req.user.id, aktion: 'rechnung.entwurf_geloescht', tabelle: 'rechnungen', datensatzId: req.params.id, req });
    res.json({ message: 'Entwurf geloescht.' });
  } catch (e) { next(e); }
});

// ── POST /:id/festschreiben ── Nummer vergeben, einfrieren, PDF erzeugen, sperren
router.post('/:id/festschreiben', async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const rRes = await client.query('SELECT * FROM rechnungen WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!rRes.rows.length) { const e = new Error('Rechnung nicht gefunden.'); e.status = 404; throw e; }
      const rech = rRes.rows[0];
      if (rech.status !== 'entwurf') { const e = new Error('Rechnung ist bereits festgeschrieben oder storniert.'); e.status = 400; throw e; }
      const pos = (await client.query('SELECT * FROM rechnung_positionen WHERE rechnung_id=$1 ORDER BY position', [req.params.id])).rows;
      if (!pos.length) { const e = new Error('Rechnung hat keine Positionen.'); e.status = 400; throw e; }

      const einst = (await client.query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
      const aussteller = ausstellerSnapshot(einst);
      // Empfaenger ist der beim Entwurf gespeicherte Snapshot (NICHT erneut aus dem Kundenstamm ziehen,
      // damit manuell erfasste/abweichende Empfaengerdaten erhalten bleiben).
      const emp = {
        empfaenger_anrede: rech.empfaenger_anrede, empfaenger_vorname: rech.empfaenger_vorname, empfaenger_nachname: rech.empfaenger_nachname,
        empfaenger_name: rech.empfaenger_name, empfaenger_firma: rech.empfaenger_firma,
        empfaenger_strasse: rech.empfaenger_strasse, empfaenger_plz: rech.empfaenger_plz, empfaenger_ort: rech.empfaenger_ort
      };

      // ── § 14 UStG: Pflichtangaben vor dem Festschreiben prüfen ──
      if (!emp.empfaenger_name && !emp.empfaenger_firma) {
        const e = new Error('Empfänger fehlt: bitte Name oder Firma angeben.'); e.status = 400; throw e;
      }
      if (!aussteller.steuernummer && !aussteller.ust_id) {
        const e = new Error('Bitte zuerst Steuernummer oder USt-IdNr. in den Einstellungen hinterlegen (§ 14 UStG).'); e.status = 400; throw e;
      }
      if (Number(rech.brutto_summe) > 250 && (!emp.empfaenger_strasse || !emp.empfaenger_plz || !emp.empfaenger_ort)) {
        const e = new Error('Für Rechnungen über 250 € ist die vollständige Anschrift des Empfängers Pflicht (Straße, PLZ, Ort — § 14 UStG).'); e.status = 400; throw e;
      }

      const jahr = new Date(rech.rechnungsdatum).getFullYear();
      const cnt = await client.query(
        `INSERT INTO rechnung_counter (jahr, letzte_nr) VALUES ($1, 1)
         ON CONFLICT (jahr) DO UPDATE SET letzte_nr = rechnung_counter.letzte_nr + 1 RETURNING letzte_nr`,
        [jahr]
      );
      const nr = 'RE-' + jahr + '-' + String(cnt.rows[0].letzte_nr).padStart(4, '0');

      const zzt = parseInt(einst.zahlungsziel_tage) || 14;
      // Datumsberechnung in Postgres (vermeidet die Zeitzonen-Verschiebung von new Date())
      const fq = await client.query(
        `SELECT to_char(rechnungsdatum,'YYYY-MM-DD') AS rdatum,
                to_char(leistungsdatum,'YYYY-MM-DD') AS ldatum,
                to_char((rechnungsdatum + ($1 * INTERVAL '1 day'))::date,'YYYY-MM-DD') AS faelligkeit
         FROM rechnungen WHERE id=$2`,
        [zzt, req.params.id]
      );
      const fdaten = fq.rows[0];
      const faelligkeit = fdaten.faelligkeit;

      const pdfPfad = await erzeugeRechnungPdf(
        Object.assign({}, rech, { rechnungsnr: nr, faelligkeit: faelligkeit, rechnungsdatum: fdaten.rdatum, leistungsdatum: fdaten.ldatum, aussteller: aussteller }, emp),
        pos
      );

      const upd = await client.query(
        `UPDATE rechnungen SET rechnungsnr=$1, status='festgeschrieben', aussteller=$2,
           empfaenger_name=$3, empfaenger_firma=$4, empfaenger_strasse=$5, empfaenger_plz=$6, empfaenger_ort=$7,
           faelligkeit=$8, pdf_pfad=$9, festgeschrieben_am=NOW() WHERE id=$10 RETURNING *`,
        [nr, JSON.stringify(aussteller), emp.empfaenger_name, emp.empfaenger_firma, emp.empfaenger_strasse,
         emp.empfaenger_plz, emp.empfaenger_ort, faelligkeit, pdfPfad, req.params.id]
      );
      return upd.rows[0];
    });
    await auditLog({ userId: req.user.id, aktion: 'rechnung.festgeschrieben', tabelle: 'rechnungen', datensatzId: result.id, neueWerte: { rechnungsnr: result.rechnungsnr }, req });
    res.json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// ── POST /:id/storno ── Stornorechnung erzeugen (eigene Nummer, negative Betraege)
router.post('/:id/storno', async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const oRes = await client.query('SELECT * FROM rechnungen WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!oRes.rows.length) { const e = new Error('Rechnung nicht gefunden.'); e.status = 404; throw e; }
      const orig = oRes.rows[0];
      if (orig.status !== 'festgeschrieben') { const e = new Error('Nur festgeschriebene Rechnungen koennen storniert werden.'); e.status = 400; throw e; }
      const opos = (await client.query('SELECT * FROM rechnung_positionen WHERE rechnung_id=$1 ORDER BY position', [orig.id])).rows;

      const negPos = opos.map(function (p) {
        return { bezeichnung: 'Storno: ' + p.bezeichnung, menge: p.menge, einheit: p.einheit,
                 einzelpreis_netto: -Number(p.einzelpreis_netto), mwst_satz: p.mwst_satz, artikel_id: p.artikel_id };
      });
      const s = berechneSummen(negPos);

      const einst = (await client.query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
      const aussteller = ausstellerSnapshot(einst);
      const rdatum = heute();
      const jahr = new Date(rdatum).getFullYear();
      const cnt = await client.query(
        `INSERT INTO rechnung_counter (jahr, letzte_nr) VALUES ($1, 1)
         ON CONFLICT (jahr) DO UPDATE SET letzte_nr = rechnung_counter.letzte_nr + 1 RETURNING letzte_nr`,
        [jahr]
      );
      const nr = 'RE-' + jahr + '-' + String(cnt.rows[0].letzte_nr).padStart(4, '0');

      const ins = await client.query(
        `INSERT INTO rechnungen
           (rechnungsnr, status, kunden_id, empfaenger_anrede, empfaenger_vorname, empfaenger_nachname, empfaenger_name, empfaenger_firma, empfaenger_strasse, empfaenger_plz, empfaenger_ort,
            aussteller, rechnungsdatum, leistungsdatum, netto_summe, mwst_summe, brutto_summe, mwst_aufschluesselung,
            zahlungsstatus, storno_von_id, festgeschrieben_am, erstellt_von, notizen)
         VALUES ($1,'festgeschrieben',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16,'bezahlt',$17,NOW(),$18,$19) RETURNING *`,
        [nr, orig.kunden_id, orig.empfaenger_anrede, orig.empfaenger_vorname, orig.empfaenger_nachname, orig.empfaenger_name, orig.empfaenger_firma, orig.empfaenger_strasse, orig.empfaenger_plz, orig.empfaenger_ort,
         JSON.stringify(aussteller), rdatum, s.netto_summe, s.mwst_summe, s.brutto_summe, JSON.stringify(s.mwst_aufschluesselung),
         orig.id, req.user.id, 'Storno zu ' + orig.rechnungsnr]
      );
      const storno = ins.rows[0];
      await insertPositionen(client, storno.id, s.positionen);
      const pdfPfad = await erzeugeRechnungPdf(Object.assign({}, storno, { aussteller: aussteller }), s.positionen);
      await client.query('UPDATE rechnungen SET pdf_pfad=$1 WHERE id=$2', [pdfPfad, storno.id]);
      await client.query("UPDATE rechnungen SET status='storniert' WHERE id=$1", [orig.id]);
      return Object.assign({}, storno, { pdf_pfad: pdfPfad });
    });
    await auditLog({ userId: req.user.id, aktion: 'rechnung.storniert', tabelle: 'rechnungen', datensatzId: req.params.id, neueWerte: { storno_nr: result.rechnungsnr }, req });
    res.status(201).json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// ── PATCH /:id/bezahlt ── Zahlungsstatus setzen
router.patch('/:id/bezahlt', async (req, res, next) => {
  try {
    const bezahlt = req.body.bezahlt !== false;
    const r = await query(
      `UPDATE rechnungen SET zahlungsstatus=$1, bezahlt_am=$2 WHERE id=$3 AND status='festgeschrieben' RETURNING *`,
      [bezahlt ? 'bezahlt' : 'offen', bezahlt ? heute() : null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Rechnung nicht gefunden oder nicht festgeschrieben.' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// ── GET /:id/pdf ── PDF ausliefern
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const r = await query('SELECT rechnungsnr, pdf_pfad FROM rechnungen WHERE id=$1', [req.params.id]);
    if (!r.rows.length || !r.rows[0].pdf_pfad) return res.status(404).json({ error: 'Kein PDF vorhanden.' });
    if (!fs.existsSync(r.rows[0].pdf_pfad)) return res.status(404).json({ error: 'PDF-Datei fehlt.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + (r.rows[0].rechnungsnr || 'rechnung') + '.pdf"');
    fs.createReadStream(r.rows[0].pdf_pfad).pipe(res);
  } catch (e) { next(e); }
});

// ── POST /:id/mahnung ── Zahlungserinnerung / Mahnung per E-Mail
router.post('/:id/mahnung', async (req, res, next) => {
  try {
    const r = (await query(
      `SELECT r.*, k.email AS k_email, k.portal_email, k.vorname
       FROM rechnungen r LEFT JOIN kunden k ON k.id = r.kunden_id WHERE r.id = $1`,
      [req.params.id]
    )).rows[0];
    if (!r) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (r.status !== 'festgeschrieben' || r.zahlungsstatus !== 'offen') {
      return res.status(400).json({ error: 'Nur offene, festgeschriebene Rechnungen können gemahnt werden.' });
    }
    const mail = r.k_email || r.portal_email;
    if (!mail) return res.status(400).json({ error: 'Für diesen Kunden ist keine E-Mail hinterlegt.' });

    const einst = (await query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
    const stufe = (r.mahnstufe || 0) + 1;
    const betreff = stufe === 1 ? 'Zahlungserinnerung' : (stufe - 1) + '. Mahnung';
    const betrag = (Number(r.brutto_summe) || 0).toFixed(2).replace('.', ',') + ' €';
    const rdat = r.rechnungsdatum ? String(r.rechnungsdatum).substring(0, 10).split('-').reverse().join('.') : '';
    const bank = [einst.bank, einst.iban ? 'IBAN ' + einst.iban : null, einst.bic ? 'BIC ' + einst.bic : null].filter(Boolean).join('  ·  ');
    const html = portalMailHtml(einst, {
      titel: betreff + ' — Rechnung ' + r.rechnungsnr,
      name: r.vorname,
      absaetze: [
        'zu unserer Rechnung <strong>' + r.rechnungsnr + '</strong> vom ' + rdat + ' über <strong>' + betrag + '</strong> konnten wir bisher keinen Zahlungseingang feststellen.',
        'Wir bitten Sie, den offenen Betrag zeitnah zu begleichen. Falls Sie die Zahlung bereits veranlasst haben, betrachten Sie diese Nachricht bitte als gegenstandslos.'
      ],
      hinweis: bank ? 'Bankverbindung: ' + bank : ''
    });
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await transporter.sendMail({ from: '"Schröder & Scholz" <' + process.env.SMTP_USER + '>', to: mail, subject: betreff + ' — Rechnung ' + r.rechnungsnr, html: html });

    await query('UPDATE rechnungen SET mahnstufe=$1, mahnung_am=CURRENT_DATE WHERE id=$2', [stufe, r.id]);
    await auditLog({ userId: req.user.id, aktion: 'rechnung.mahnung', tabelle: 'rechnungen', datensatzId: r.id, neueWerte: { mahnstufe: stufe }, req });
    res.json({ message: betreff + ' gesendet.', mahnstufe: stufe });
  } catch (e) { next(e); }
});

module.exports = router;
