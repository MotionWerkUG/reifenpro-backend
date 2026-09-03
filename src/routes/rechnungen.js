'use strict';
const router = require('express').Router();
const fs = require('fs');
const { query, withTransaction } = require('../db/index');
const { authenticate, requireStaff, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const { erzeugeRechnungPdf } = require('../lib/rechnung-pdf');
const { resolvePreis } = require('../lib/preis');
const { portalMailHtml, esc } = require('../lib/mail-template');
const { sendMail } = require('../lib/mailer');
const kasse = require('../lib/kasse');

router.use(authenticate, requireStaff);

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Rechtsformen, bei denen der Firmenname selbst den Unternehmer benennt (Handelsregister).
// Bei allen anderen (Einzelunternehmen, GbR) ist der Inhabername Pflichtangabe (§ 14 UStG).
const REGISTER_RECHTSFORMEN = ['GmbH', 'UG (haftungsbeschränkt)', 'UG', 'AG', 'OHG', 'KG', 'GmbH & Co. KG', 'e.K.', 'eG'];

// Obergrenze fuer Positionen je Rechnung. Schuetzt den gemeinsamen DB-Pool vor Massen-Inserts
// und ist fuer den Werkstattbetrieb weit ueber jedem realistischen Beleg.
const MAX_POSITIONEN = 200;

// Mindestabstand zwischen zwei Mahnstufen (Tage).
const MAHN_ABSTAND_TAGE = 7;

// Tabellenkalkulationen werten Zellen, die mit = + @ oder einem Steuerzeichen beginnen, als
// FORMEL aus. Empfaengernamen stammen teils aus der oeffentlichen Terminbuchung, landen im
// Journal- und DATEV-Export und werden dort vom Steuerberater geoeffnet — deshalb wird ein
// solcher Zellinhalt mit einem Apostroph als Text markiert. Zahlen (auch negative Storno-
// Betraege) bleiben unangetastet, sonst waere der Export unbrauchbar.
function csvEntschaerft(v) {
  const s = (v == null ? '' : String(v));
  const istZahl = /^-?\d+(?:[.,]\d+)?$/.test(s);
  return (/^[=+@\t\r]/.test(s) || (s.startsWith('-') && !istZahl)) ? "'" + s : s;
}

// Zahl aus dem Client pruefen: endlich und in einem kaufmaennisch sinnvollen Rahmen.
function zahlOk(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max;
}

// Nachlass je Position. Der Flyer verspricht gestaffelte Saetze (25 % auf die Einlagerung,
// 10 % auf alles andere), also koennen in EINER Rechnung mehrere Rabattsaetze auftreten.
//
// Der Nachlass wird als eigene Minusposition ausgewiesen, nicht in den Preis eingerechnet:
// § 14 Abs. 4 Nr. 7 UStG verlangt, dass eine im Voraus vereinbarte Entgeltminderung
// erkennbar ist, und der Kunde soll sehen, was ihm der Code gebracht hat.
//
// Gruppiert wird je Rabattsatz UND Steuersatz — sonst waere der Steuerausweis falsch, sobald
// unterschiedlich besteuerte Leistungen denselben Nachlass bekommen. Gerundet wird EINMAL je
// Gruppe auf die Summe, nicht je Zeile; sonst laeuft die Summe um Cents von dem weg, was der
// Kunde bei der Buchung gesehen hat.
function nachlassPositionen(positionen, quelle) {
  const gruppen = new Map();
  (positionen || []).forEach(function (p) {
    const rab = Number(p.rabatt_prozent);
    if (!Number.isFinite(rab) || rab <= 0) return;
    const satz = Number.isFinite(Number(p.mwst_satz)) ? Number(p.mwst_satz) : 19;
    const brutto = (p.einzelpreis_brutto != null);
    const basis = brutto
      ? round2((Number(p.menge) || 0) * (Number(p.einzelpreis_brutto) || 0))
      : round2((Number(p.menge) || 0) * (Number(p.einzelpreis_netto) || 0));
    if (basis <= 0) return;
    const key = rab + '|' + satz + '|' + (brutto ? 'b' : 'n');
    const g = gruppen.get(key) || { rabatt: rab, satz: satz, brutto: brutto, basis: 0, namen: [] };
    g.basis = round2(g.basis + basis);
    g.namen.push(String(p.bezeichnung || '').trim());
    gruppen.set(key, g);
  });

  return Array.from(gruppen.values()).map(function (g) {
    // Bezeichnung: Bei genau einer betroffenen Leistung wird sie benannt, sonst zusammengefasst.
    const was = g.namen.length === 1 ? g.namen[0] : 'übrige Leistungen';
    const betrag = -round2(g.basis * g.rabatt / 100);
    const pos = { bezeichnung: 'Nachlass ' + was + ' (' + g.rabatt + ' %)' + (quelle ? ' — ' + quelle : ''), menge: 1, einheit: null, mwst_satz: g.satz };
    if (g.brutto) pos.einzelpreis_brutto = betrag; else pos.einzelpreis_netto = betrag;
    return pos;
  });
}

// Positionen aus dem Client pruefen. Liefert eine Fehlermeldung oder null.
// Faengt ab: fehlende Bezeichnung (§ 14 Abs. 4 Nr. 5 UStG), unsinnige/unendliche Zahlen und
// Massen-Positionen, die den gemeinsamen Datenbank-Pool blockieren wuerden.
function pruefePositionen(positionen) {
  if (!Array.isArray(positionen) || !positionen.length) return 'Mindestens eine Position erforderlich.';
  if (positionen.length > MAX_POSITIONEN) return 'Zu viele Positionen (maximal ' + MAX_POSITIONEN + ' je Rechnung).';
  for (let i = 0; i < positionen.length; i++) {
    const p = positionen[i] || {};
    const nr = 'Position ' + (i + 1) + ': ';
    if (!String(p.bezeichnung == null ? '' : p.bezeichnung).trim()) return nr + 'Bezeichnung fehlt (Art der Leistung ist Pflichtangabe).';
    if (String(p.bezeichnung).length > 200) return nr + 'Bezeichnung ist zu lang (maximal 200 Zeichen).';
    // Steuerzeichen (inklusive NUL) kann PostgreSQL nicht speichern — sonst endet die Anfrage
    // in einem Serverfehler statt in einer verstaendlichen Meldung.
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(String(p.bezeichnung) + String(p.einheit == null ? '' : p.einheit))) {
      return nr + 'Bezeichnung oder Einheit enthält unerlaubte Steuerzeichen.';
    }
    if (p.einheit != null && String(p.einheit).length > 30) return nr + 'Einheit ist zu lang (maximal 30 Zeichen).';
    if (!zahlOk(p.menge, 0, 100000)) return nr + 'Menge ist keine gültige Zahl.';
    const preis = (p.einzelpreis_netto != null) ? p.einzelpreis_netto : p.einzelpreis_brutto;
    if (!zahlOk(preis, -1000000, 1000000)) return nr + 'Einzelpreis ist keine gültige Zahl.';
    // Die Betragsspalten sind numeric(10,2): das Produkt muss ebenfalls hineinpassen.
    if (!zahlOk(Number(p.menge) * Number(preis), -99999999.99, 99999999.99)) return nr + 'Zeilenbetrag ist zu groß.';
    if (p.mwst_satz != null && !zahlOk(p.mwst_satz, 0, 100)) return nr + 'Steuersatz ist keine gültige Zahl.';
    if (p.rabatt_prozent != null && !zahlOk(p.rabatt_prozent, 0, 100)) return nr + 'Nachlass ist kein gültiger Prozentsatz (0 bis 100).';
  }
  return null;
}

// Summen + normalisierte Positionen serverseitig berechnen (Client-Werte werden NICHT vertraut)
// spiegeln=true erlaubt es, die gespeicherten Zeilenbetraege einer Originalposition
// unveraendert (negiert) zu uebernehmen, statt sie neu hochzurechnen. Das ist NUR fuer den
// Storno gedacht und wird bewusst ueber einen Parameter gesteuert: Felder aus dem Request-Body
// koennen dadurch niemals Betraege diktieren.
function berechneSummen(positionen, spiegeln) {
  let netto = 0, brutto = 0;
  const proSatz = {};
  const norm = (positionen || []).map(function (p, i) {
    const menge = Number(p.menge) || 0;
    const satz = Number(p.mwst_satz);
    const mwst = Number.isFinite(satz) ? satz : 19;
    // Zwei Preisrichtungen:
    // a) einzelpreis_brutto gesetzt -> der Bruttopreis ist der zugesagte Endpreis und bleibt exakt;
    //    die Steuer wird herausgerechnet (brutto * satz / (100 + satz)). Betrieb mit Endpreisen.
    // b) sonst wie bisher: Nettopreis ist die Basis, Brutto wird aufgeschlagen.
    const epBrutto = Number(p.einzelpreis_brutto);
    let ep, zNetto, zBrutto;
    if (spiegeln && p.spiegel_netto != null && p.spiegel_brutto != null) {
      // c) Storno: Die Zeilenbetraege des Originals werden exakt uebernommen. Neu hochrechnen
      //    wuerde bei Endpreisen bis zu einem Cent abweichen (44,00 -> 36,97 -> 43,99), und ein
      //    Storno, der die Originalrechnung nicht auf null stellt, laesst auf dem Debitorenkonto
      //    einen Rest stehen — obwohl der Beleg woertlich "hebt vollstaendig auf" druckt.
      zNetto = round2(Number(p.spiegel_netto));
      zBrutto = round2(Number(p.spiegel_brutto));
      ep = Number(p.einzelpreis_netto) || 0;
    } else if (p.einzelpreis_netto == null && Number.isFinite(epBrutto)) {
      zBrutto = round2(menge * epBrutto);
      zNetto = round2(zBrutto - round2(zBrutto * mwst / (100 + mwst)));
      ep = menge ? round2(zNetto / menge) : 0;
    } else {
      ep = Number(p.einzelpreis_netto) || 0;
      zNetto = round2(menge * ep);
      zBrutto = round2(zNetto * (1 + mwst / 100));
    }
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
  empfaenger_name: null, empfaenger_firma: null, empfaenger_strasse: null, empfaenger_plz: null, empfaenger_ort: null,
  empfaenger_land: null
};

async function ladeEmpfaenger(kunden_id) {
  if (!kunden_id) return Object.assign({}, LEER_EMPF);
  const { rows } = await query('SELECT anrede,vorname,nachname,firma,strasse,plz,ort,land FROM kunden WHERE id=$1', [kunden_id]);
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
    empfaenger_ort: k.ort || null,
    // Laendercode als Snapshot: die Rechnung soll den Stand bei Ausstellung festhalten.
    empfaenger_land: k.land || null
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
    empfaenger_ort: s(e.ort),
    empfaenger_land: s(e.land)
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

// R5: Plausibilitaetsgrenze fuer ein im Entwurf angegebenes Datum (Format, Jahr ab 2020).
// Fuer das Rechnungsdatum zusaetzlich "nicht in der Zukunft" (1 Tag Zeitzonen-Toleranz) —
// das endgueltige Rechnungsdatum wird beim Festschreiben ohnehin auf das Serverdatum gesetzt.
// Das Leistungsdatum DARF in der Zukunft liegen (Vorab-Rechnung, § 14 Abs. 4 Nr. 6 UStG) ->
// dann zukunftErlaubt=true. Faengt grob unsinnige Eingaben (z. B. Jahr 2099) ab. Leer = ok.
function datumPlausibel(d, zukunftErlaubt) {
  if (d == null || d === '') return true;
  const s = String(d).substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const jahr = parseInt(s.slice(0, 4), 10);
  if (jahr < 2020 || jahr > new Date().getFullYear() + 1) return false;
  if (zukunftErlaubt) return true;
  const morgen = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return s <= morgen;
}

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

// ── GET /kassenstatus ── Ist die Kassenanbindung auf diesem Server eingerichtet?
// Die Oberflaeche fragt das ab und blendet die Kassieren-Knoepfe sonst gar nicht erst ein:
// Ein Knopf, der nur eine Fehlermeldung erzeugen kann, ist eine Sackgasse.
router.get('/kassenstatus', async (req, res) => {
  res.json({ konfiguriert: kasse.konfiguriert() });
});

// ── GET /export ── GoBD: Rechnungsjournal als CSV (maschinell auswertbar) ──
router.get('/export', requireAdmin, async (req, res, next) => {
  try {
    const jahr = parseInt(req.query.jahr) || new Date().getFullYear();
    const { rows } = await query(
      `SELECT rechnungsnr, status, to_char(rechnungsdatum,'YYYY-MM-DD') AS rechnungsdatum,
              to_char(leistungsdatum,'YYYY-MM-DD') AS leistungsdatum, to_char(faelligkeit,'YYYY-MM-DD') AS faelligkeit,
              empfaenger_name, empfaenger_firma, empfaenger_plz, empfaenger_ort,
              netto_summe, mwst_summe, brutto_summe, zahlungsstatus, to_char(bezahlt_am,'YYYY-MM-DD') AS bezahlt_am,
              (storno_von_id IS NOT NULL) AS ist_storno, to_char(festgeschrieben_am,'YYYY-MM-DD"T"HH24:MI:SS') AS festgeschrieben_am
       FROM rechnungen
       WHERE status IN ('festgeschrieben','storniert') AND EXTRACT(YEAR FROM rechnungsdatum)=$1
       ORDER BY rechnungsnr`,
      [jahr]
    );
    const sep = ';';
    const num = (n) => (Number(n) || 0).toFixed(2).replace('.', ',');
    const cell = (v) => { const s = csvEntschaerft(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const kopf = ['Rechnungsnr', 'Status', 'Rechnungsdatum', 'Leistungsdatum', 'Faelligkeit', 'Empfaenger', 'Firma', 'PLZ', 'Ort', 'Netto', 'MwSt', 'Brutto', 'Zahlungsstatus', 'Bezahlt am', 'Storno', 'Festgeschrieben am'];
    const zeilen = rows.map((r) => [r.rechnungsnr, r.status, r.rechnungsdatum, r.leistungsdatum, r.faelligkeit,
      r.empfaenger_name, r.empfaenger_firma, r.empfaenger_plz, r.empfaenger_ort,
      num(r.netto_summe), num(r.mwst_summe), num(r.brutto_summe), r.zahlungsstatus, r.bezahlt_am,
      r.ist_storno ? 'ja' : 'nein', r.festgeschrieben_am].map(cell).join(sep));
    const csv = '﻿' + [kopf.join(sep)].concat(zeilen).join('\r\n') + '\r\n';
    await auditLog({ userId: req.user.id, aktion: 'rechnung.export', tabelle: 'rechnungen', datensatzId: null, neueWerte: { jahr: jahr, anzahl: rows.length }, req });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Rechnungsjournal-' + jahr + '.csv"');
    res.send(csv);
  } catch (e) { next(e); }
});

// ── GET /export-datev ── DATEV-EXTF Buchungsstapel (festgeschriebene Rechnungen eines Jahres) ──
// Erloesbuchung je Rechnung und Steuersatz (Debitoren-Sammelkonto gegen Erloes-Automatikkonto).
// Konten/Berater/Mandant aus den Einstellungen (SKR03-Standardwerte). Vor Produktivnutzung vom
// Steuerberater einmalig testweise importieren und Kontenrahmen bestaetigen lassen.
router.get('/export-datev', requireAdmin, async (req, res, next) => {
  try {
    const jahr = parseInt(req.query.jahr) || new Date().getFullYear();
    const e = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    const kDeb = e.datev_konto_debitoren || '1400';
    const k19  = e.datev_konto_erloes_19 || '8400';
    const k7   = e.datev_konto_erloes_7  || '8300';
    // DATEV erwartet hier unquotierte Zahlfelder. Ein Semikolon oder Anfuehrungszeichen aus den
    // Einstellungen wuerde die Kopfzeile zerlegen, deshalb bleiben nur Ziffern stehen.
    const nurZiffern = (v) => String(v == null ? '' : v).replace(/\D/g, '');
    const berater = nurZiffern(e.datev_berater_nr);
    const mandant = nurZiffern(e.datev_mandant_nr);
    const skl = parseInt(e.datev_sachkontenlaenge) || 4;
    const { rows } = await query(
      `SELECT rechnungsnr, to_char(rechnungsdatum,'DDMM') AS beleg,
              COALESCE(empfaenger_firma, empfaenger_name, '') AS name, mwst_aufschluesselung,
              (storno_von_id IS NOT NULL) AS ist_storno
       FROM rechnungen WHERE status IN ('festgeschrieben','storniert') AND EXTRACT(YEAR FROM rechnungsdatum)=$1 ORDER BY rechnungsnr`,
      [jahr]);
    const dec = (n) => (Math.abs(Number(n) || 0)).toFixed(2).replace('.', ',');
    const q = (s) => '"' + csvEntschaerft(s).replace(/"/g, '""') + '"';
    const p = (n, l) => String(n).padStart(l, '0');
    const d = new Date();
    const created = '' + d.getFullYear() + p(d.getMonth() + 1, 2) + p(d.getDate(), 2) + p(d.getHours(), 2) + p(d.getMinutes(), 2) + p(d.getSeconds(), 2) + '000';
    const wj = jahr + '0101', von = jahr + '0101', bis = jahr + '1231';
    const kopf = ['"EXTF"', '700', '21', '"Buchungsstapel"', '9', created, '', '', '', '', berater, mandant, wj, skl, von, bis, q('ReifenPro Rechnungen ' + jahr), '""', '1', '0', '0', '0', '"EUR"', '', '', '', '', '', '', ''].join(';');
    const spalten = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext'].map(q).join(';');
    const zeilen = [];
    rows.forEach((r) => {
      let auf = r.mwst_aufschluesselung;
      if (typeof auf === 'string') { try { auf = JSON.parse(auf); } catch (x) { auf = []; } }
      (auf || []).forEach((a) => {
        const brutto = (Number(a.netto) || 0) + (Number(a.mwst) || 0);
        if (!brutto) return;
        const gegen = Number(a.satz) === 7 ? k7 : k19;
        const sh = brutto < 0 ? 'H' : 'S';
        zeilen.push([dec(brutto), q(sh), '"EUR"', '', '', '', kDeb, gegen, '', r.beleg, q(r.rechnungsnr), '', '', q(String(r.name).substring(0, 60))].join(';'));
      });
    });
    const inhalt = '﻿' + [kopf, spalten].concat(zeilen).join('\r\n') + '\r\n';
    await auditLog({ userId: req.user.id, aktion: 'rechnung.export_datev', tabelle: 'rechnungen', datensatzId: null, neueWerte: { jahr: jahr, buchungen: zeilen.length }, req });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="DATEV-EXTF-' + jahr + '.csv"');
    res.send(inhalt);
  } catch (e) { next(e); }
});

// ── GET /:id/xrechnung ── E-Rechnung als XRechnung (UBL 2.1, EN 16931 / XRechnung 3.0) ──
// Fuer B2B-/Behoerden-Rechnungen. Vor Produktivnutzung einmal mit dem KoSIT-Validator pruefen.
router.get('/:id/xrechnung', async (req, res, next) => {
  try {
    const r = (await query('SELECT * FROM rechnungen WHERE id=$1', [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (r.status !== 'festgeschrieben') return res.status(400).json({ error: 'Nur festgeschriebene Rechnungen können als E-Rechnung exportiert werden.' });
    const pos = (await query('SELECT * FROM rechnung_positionen WHERE rechnung_id=$1 ORDER BY position', [r.id])).rows;
    let a = r.aussteller || {}; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = {}; } }
    let auf = r.mwst_aufschluesselung; if (typeof auf === 'string') { try { auf = JSON.parse(auf); } catch (e) { auf = []; } }
    const x = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const m = (n) => (Number(n) || 0).toFixed(2);
    const iso = (d) => d ? String(d).substring(0, 10) : '';
    const cur = ' currencyID="EUR"';
    const typeCode = r.storno_von_id ? '384' : '380';
    const buyerRef = r.empfaenger_firma || r.empfaenger_name || 'N/A';
    const empfName = r.empfaenger_firma || r.empfaenger_name || '';
    // Elektronische Adressen (BT-34 Verkaeufer / BT-49 Kaeufer) — Pflicht in XRechnung.
    const buyerEmail = r.kunden_id ? ((await query('SELECT COALESCE(portal_email, email) AS m FROM kunden WHERE id=$1', [r.kunden_id])).rows[0] || {}).m : null;
    const sellerEP = a.email ? '      <cbc:EndpointID schemeID="EM">' + x(a.email) + '</cbc:EndpointID>\n' : '';
    const buyerEP = buyerEmail ? '      <cbc:EndpointID schemeID="EM">' + x(buyerEmail) + '</cbc:EndpointID>\n' : '';
    // Steuer-Untergruppen je Satz
    const subtotals = (auf || []).map((t) =>
      '  <cac:TaxSubtotal>\n' +
      '    <cbc:TaxableAmount' + cur + '>' + m(t.netto) + '</cbc:TaxableAmount>\n' +
      '    <cbc:TaxAmount' + cur + '>' + m(t.mwst) + '</cbc:TaxAmount>\n' +
      '    <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>' + m(t.satz) + '</cbc:Percent>' +
      '<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>\n' +
      '  </cac:TaxSubtotal>').join('\n');
    // Rechnungspositionen
    const lines = pos.map((p, i) =>
      '  <cac:InvoiceLine>\n' +
      '    <cbc:ID>' + (i + 1) + '</cbc:ID>\n' +
      '    <cbc:InvoicedQuantity unitCode="C62">' + (Number(p.menge) || 0) + '</cbc:InvoicedQuantity>\n' +
      '    <cbc:LineExtensionAmount' + cur + '>' + m(p.zeilen_netto) + '</cbc:LineExtensionAmount>\n' +
      '    <cac:Item><cbc:Name>' + x(p.bezeichnung || 'Position') + '</cbc:Name>' +
      '<cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>' + m(p.mwst_satz) + '</cbc:Percent>' +
      '<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>\n' +
      '    <cac:Price><cbc:PriceAmount' + cur + '>' + m(Math.abs(Number(p.einzelpreis_netto) || 0)) + '</cbc:PriceAmount></cac:Price>\n' +
      '  </cac:InvoiceLine>').join('\n');
    // Laendercode des Empfaengers aus dem Rechnungs-Snapshot. Fehlt er (Altbestand oder nie
    // erfasst), gilt Deutschland — der Betrieb rechnet im Inland ab. Der Aussteller bleibt
    // fest DE: er sitzt in Deutschland, das ist keine variable Groesse.
    const empfLand = String(r.empfaenger_land || 'DE').trim().toUpperCase().slice(0, 2) || 'DE';
    // Verkaeufer-Steuer-IDs (USt-IdNr und/oder Steuernummer)
    let sellerTax = '';
    if (a.ust_id) sellerTax += '      <cac:PartyTaxScheme><cbc:CompanyID>' + x(a.ust_id) + '</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>\n';
    if (a.steuernummer) sellerTax += '      <cac:PartyTaxScheme><cbc:CompanyID>' + x(a.steuernummer) + '</cbc:CompanyID><cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>\n';
    const xml =
'<?xml version="1.0" encoding="UTF-8"?>\n' +
'<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">\n' +
'  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>\n' +
'  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>\n' +
'  <cbc:ID>' + x(r.rechnungsnr) + '</cbc:ID>\n' +
'  <cbc:IssueDate>' + iso(r.rechnungsdatum) + '</cbc:IssueDate>\n' +
(r.faelligkeit ? '  <cbc:DueDate>' + iso(r.faelligkeit) + '</cbc:DueDate>\n' : '') +
'  <cbc:InvoiceTypeCode>' + typeCode + '</cbc:InvoiceTypeCode>\n' +
'  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>\n' +
'  <cbc:BuyerReference>' + x(buyerRef) + '</cbc:BuyerReference>\n' +
'  <cac:AccountingSupplierParty><cac:Party>\n' +
sellerEP +
'      <cac:PostalAddress><cbc:StreetName>' + x(a.strasse) + '</cbc:StreetName><cbc:CityName>' + x(a.ort) + '</cbc:CityName><cbc:PostalZone>' + x(a.plz) + '</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>\n' +
sellerTax +
'      <cac:PartyLegalEntity><cbc:RegistrationName>' + x(a.firmenname || 'Schröder & Scholz') + '</cbc:RegistrationName></cac:PartyLegalEntity>\n' +
'      <cac:Contact><cbc:Name>' + x(a.inhaber || a.firmenname || '') + '</cbc:Name>' + (a.telefon ? '<cbc:Telephone>' + x(a.telefon) + '</cbc:Telephone>' : '') + (a.email ? '<cbc:ElectronicMail>' + x(a.email) + '</cbc:ElectronicMail>' : '') + '</cac:Contact>\n' +
'  </cac:Party></cac:AccountingSupplierParty>\n' +
'  <cac:AccountingCustomerParty><cac:Party>\n' +
buyerEP +
'      <cac:PostalAddress><cbc:StreetName>' + x(r.empfaenger_strasse) + '</cbc:StreetName><cbc:CityName>' + x(r.empfaenger_ort) + '</cbc:CityName><cbc:PostalZone>' + x(r.empfaenger_plz) + '</cbc:PostalZone><cac:Country><cbc:IdentificationCode>' + x(empfLand) + '</cbc:IdentificationCode></cac:Country></cac:PostalAddress>\n' +
'      <cac:PartyLegalEntity><cbc:RegistrationName>' + x(empfName) + '</cbc:RegistrationName></cac:PartyLegalEntity>\n' +
'  </cac:Party></cac:AccountingCustomerParty>\n' +
(a.iban ? '  <cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>' + x(a.iban) + '</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>\n' : '') +
'  <cac:TaxTotal><cbc:TaxAmount' + cur + '>' + m(r.mwst_summe) + '</cbc:TaxAmount>\n' + subtotals + '\n  </cac:TaxTotal>\n' +
'  <cac:LegalMonetaryTotal>\n' +
'    <cbc:LineExtensionAmount' + cur + '>' + m(r.netto_summe) + '</cbc:LineExtensionAmount>\n' +
'    <cbc:TaxExclusiveAmount' + cur + '>' + m(r.netto_summe) + '</cbc:TaxExclusiveAmount>\n' +
'    <cbc:TaxInclusiveAmount' + cur + '>' + m(r.brutto_summe) + '</cbc:TaxInclusiveAmount>\n' +
'    <cbc:PayableAmount' + cur + '>' + m(r.brutto_summe) + '</cbc:PayableAmount>\n' +
'  </cac:LegalMonetaryTotal>\n' +
lines + '\n' +
'</ubl:Invoice>\n';
    await auditLog({ userId: req.user.id, aktion: 'rechnung.xrechnung', tabelle: 'rechnungen', datensatzId: r.id, req });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + r.rechnungsnr + '.xml"');
    res.send(xml);
  } catch (e) { next(e); }
});

// ── GET /verfahrensdokumentation ── GoBD: Verfahrensdokumentation als druckbares HTML ──
router.get('/verfahrensdokumentation', async (req, res, next) => {
  try {
    const e = (await query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const firma = esc(e.firmenname || 'Schröder & Scholz');
    const adr = [e.strasse, [e.plz, e.ort].filter(Boolean).join(' ')].filter(Boolean).map(esc).join(', ');
    const stand = new Date().toISOString().substring(0, 10);
    const steuer = [e.steuernummer ? 'Steuernr. ' + esc(e.steuernummer) : '', e.ust_id ? 'USt-IdNr. ' + esc(e.ust_id) : ''].filter(Boolean).join(' · ') || '— (in den Einstellungen hinterlegen) —';
    const html = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Verfahrensdokumentation – ' + firma + '</title>' +
      '<style>body{font-family:-apple-system,Arial,sans-serif;max-width:820px;margin:30px auto;padding:0 20px;line-height:1.6;color:#1a1a1a}' +
      'h1{font-size:22px}h2{font-size:16px;margin-top:26px;border-bottom:2px solid #eab308;padding-bottom:4px}' +
      'table{border-collapse:collapse;width:100%;margin:8px 0}td{border:1px solid #ddd;padding:6px 9px;font-size:14px;vertical-align:top}' +
      '.muted{color:#777;font-size:13px}@media print{body{margin:0}}</style></head><body>' +
      '<h1>Verfahrensdokumentation zur Rechnungserstellung</h1>' +
      '<p class="muted">' + firma + (adr ? ', ' + adr : '') + ' · ' + steuer + '<br>Stand: ' + stand + ' · System: ReifenPro (Eigenentwicklung)</p>' +
      '<h2>1. Zweck und Geltungsbereich</h2><p>Diese Dokumentation beschreibt das eingesetzte Verfahren zur Erstellung, Festschreibung, Aufbewahrung und Stornierung von Ausgangsrechnungen gemäß GoBD und § 14 UStG.</p>' +
      '<h2>2. Rechnungsnummern</h2><p>Die Vergabe erfolgt automatisch, fortlaufend und lückenlos im Format <strong>RE-JJJJ-NNNN</strong> (Jahr + laufende Nummer). Die Vergabe geschieht atomar in einer Datenbank-Transaktion über einen Zähler je Jahr; doppelte Nummern sind durch eine Eindeutigkeits-Beschränkung technisch ausgeschlossen.</p>' +
      '<h2>3. Festschreibung und Unveränderbarkeit</h2><p>Eine Rechnung ist zunächst ein <em>Entwurf</em> und änderbar. Mit dem <em>Festschreiben</em> erhält sie die Rechnungsnummer, ein eingefrorenes Aussteller- und Empfänger-Abbild sowie ein erzeugtes PDF; danach ist sie technisch gegen Änderung und Löschung gesperrt. Pflichtangaben nach § 14 UStG (Empfänger, ab 250 € vollständige Anschrift, Steuernr./USt-IdNr.) werden vor dem Festschreiben geprüft.</p>' +
      '<h2>4. Korrekturen / Storno</h2><p>Festgeschriebene Rechnungen werden nicht gelöscht oder geändert. Korrekturen erfolgen ausschließlich über eine <strong>Stornorechnung</strong> mit eigener fortlaufender Nummer und negativen Beträgen, die auf die Originalrechnung verweist. Das Original bleibt erhalten und wird als „storniert" gekennzeichnet.</p>' +
      '<h2>5. Protokollierung (Nachvollziehbarkeit)</h2><p>Alle relevanten Vorgänge (Entwurf anlegen/ändern, Festschreiben, Storno, Zahlungsstatus, Mahnung, Export) werden mit Benutzer, Zeitpunkt und Vorgang in einem Änderungs-/Audit-Protokoll erfasst.</p>' +
      '<h2>6. Aufbewahrung</h2><p>Rechnungen (Datensatz und PDF) werden gemäß § 147 Abs. 3 AO / § 14b Abs. 1 UStG <strong>8 Jahre</strong> aufbewahrt und maschinell auswertbar vorgehalten. Ein Export des Rechnungsjournals als CSV steht für die Betriebsprüfung zur Verfügung.</p>' +
      '<h2>7. Technik und Datensicherung</h2><p>Betrieb auf einem Server (PostgreSQL-Datenbank, Node.js-Anwendung). <span class="muted">Hinweis: Das Datensicherungskonzept (regelmäßige Backups, Aufbewahrung der Sicherungen) ist organisatorisch festzulegen und hier zu ergänzen.</span></p>' +
      '<h2>8. Verantwortlich</h2><p>' + esc(e.inhaber || firma) + '</p>' +
      '<p class="muted" style="margin-top:30px">Diese Dokumentation ist eine Vorlage. Bitte durch Steuerberater prüfen und um das individuelle Datensicherungs- und Zugriffskonzept ergänzen.</p>' +
      '</body></html>';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
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
    const posFehler = pruefePositionen(positionen);
    if (posFehler) return res.status(400).json({ error: posFehler });
    if (!datumPlausibel(rechnungsdatum)) return res.status(400).json({ error: 'Unplausibles Rechnungsdatum (Format JJJJ-MM-TT, Jahr ab 2020, nicht in der Zukunft).' });
    if (!datumPlausibel(leistungsdatum, true)) return res.status(400).json({ error: 'Unplausibles Leistungsdatum (Format JJJJ-MM-TT, Jahr ab 2020).' });
    // Empfaenger: explizite Eingabe (Snapshot) bevorzugen, sonst aus Kundenstamm laden
    const emp = empfaengerAusBody(req.body) || await ladeEmpfaenger(kunden_id || null);
    if (!emp.empfaenger_name && !emp.empfaenger_firma && !kunden_id) {
      return res.status(400).json({ error: 'Bitte einen Kunden wählen oder einen Empfänger (Name oder Firma) eintragen.' });
    }
    // Gutschein/Rabatt anwenden: geprueften Code -> Rabattposition je MwSt-Satz (Aufschluesselung bleibt korrekt)
    // Nachlass je Position (gestaffelte Saetze) hat Vorrang: Tragen einzelne Positionen einen
    // eigenen Rabattsatz, entstehen daraus die Minuspositionen. Der belegweite Gutscheinrabatt
    // bleibt daneben fuer den einfachen Fall bestehen — beides zusammen waere doppelt.
    let posFinal = positionen.concat(nachlassPositionen(positionen));
    const gestaffelt = posFinal.length > positionen.length;
    let rabattProzent = 0, rabattLabel = null;
    const code = (req.body.gutschein_code || '').toString().trim();
    if (code) {
      const g = (await query(
        "SELECT code, rabatt_prozent FROM gutscheine WHERE UPPER(code)=UPPER($1) AND aktiv=true AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE)",
        [code])).rows[0];
      if (!g) return res.status(400).json({ error: 'Gutschein ungültig oder abgelaufen.' });
      rabattProzent = Number(g.rabatt_prozent) || 0;
      rabattLabel = 'Gutschein ' + g.code;
    } else if (Number(req.body.rabatt_prozent) > 0) {
      rabattProzent = Math.min(Number(req.body.rabatt_prozent), 100);
      rabattLabel = 'Rabatt';
    }
    rabattProzent = Math.min(Math.max(rabattProzent, 0), 100);
    if (gestaffelt && rabattProzent > 0) {
      return res.status(400).json({ error: 'Es sind bereits Nachlässe je Position gesetzt. Ein zusätzlicher Rabatt auf den ganzen Beleg würde doppelt abziehen.' });
    }
    if (rabattProzent > 0) {
      const basis = berechneSummen(positionen);
      const rabattPos = basis.mwst_aufschluesselung
        .filter(function (r) { return r.netto > 0; })
        .map(function (r) {
          return { bezeichnung: rabattLabel + ' (-' + rabattProzent + ' %)', menge: 1, einheit: null,
                   einzelpreis_netto: -round2(r.netto * rabattProzent / 100), mwst_satz: r.satz };
        });
      posFinal = posFinal.concat(rabattPos);
    }
    const s = berechneSummen(posFinal);
    const rdatum = rechnungsdatum || heute();
    const ldatum = leistungsdatum || rdatum;
    const result = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO rechnungen
           (status, kunden_id, empfaenger_anrede, empfaenger_vorname, empfaenger_nachname, empfaenger_name, empfaenger_firma, empfaenger_strasse, empfaenger_plz, empfaenger_ort,
            empfaenger_land, rechnungsdatum, leistungsdatum, netto_summe, mwst_summe, brutto_summe, mwst_aufschluesselung, notizen, erstellt_von)
         VALUES ('entwurf',$1,$2,$3,$4,$5,$6,$7,$8,$9,$18,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [kunden_id || null, emp.empfaenger_anrede, emp.empfaenger_vorname, emp.empfaenger_nachname, emp.empfaenger_name, emp.empfaenger_firma, emp.empfaenger_strasse, emp.empfaenger_plz, emp.empfaenger_ort,
         rdatum, ldatum, s.netto_summe, s.mwst_summe, s.brutto_summe, JSON.stringify(s.mwst_aufschluesselung), notizen || null, req.user.id, emp.empfaenger_land]
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
    // Gast-Termine ohne Kundenkonto sind erlaubt: der Empfaenger wird unten als Snapshot aus den
    // Termin-Kontaktdaten gebaut (kein Kundenstamm). Fehlt jeglicher Name, kommt dort ein klarer Fehler.
    if (t.rechnung_id) return res.status(409).json({ error: 'Für diesen Termin wurde bereits eine Rechnung erstellt.' });

    let typ = null;
    if (t.fahrzeug_id) {
      const f = (await query('SELECT typ FROM fahrzeuge WHERE id=$1', [t.fahrzeug_id])).rows[0];
      if (f) typ = f.typ;
    }
    // Bei preise_inkl_mwst=true sind artikel.preis und kunden_preise BRUTTO-Endpreise. Sie
    // werden weiter unten als Bruttopreis uebergeben und bleiben damit exakt erhalten — sie
    // werden NICHT mehr auf Netto umgerechnet. Der frueher hier stehende Hinweis auf eine
    // Netto-Umrechnung war seit der Endpreis-Umstellung falsch.
    const inkl = (((await query('SELECT preise_inkl_mwst FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {}).preise_inkl_mwst) !== false;
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
    // Positionen: bevorzugt die gebuchten Leistungen (inkl. Zusatzleistungen + Fahrzeug-Zuschlag) aus dem Termin,
    // sonst Fallback auf die einzelne Hauptleistung.
    let leist = t.leistungen; if (typeof leist === 'string') { try { leist = JSON.parse(leist); } catch (e) { leist = null; } }
    let positionen;
    // Woraus der Nachlass stammt, friert die Buchung je Leistung in preis_quelle ein. Gutschein
    // und Gewerbe-Kondition schliessen sich seit der Portal-Aenderung gegenseitig aus, es gibt
    // also je Termin genau eine Herkunft. Der Gutscheincode steht einmal an termine.gutschein_code
    // und wird bewusst nicht je Position dupliziert.
    const quellen = new Set((Array.isArray(leist) ? leist : []).map((p) => String(p.preis_quelle || '').toLowerCase()));
    const nachlassHerkunft = t.gutschein_code
      ? 'Gutschein ' + t.gutschein_code
      : (quellen.has('konditionen') ? 'Vereinbarter Nachlass' : null);
    if (Array.isArray(leist) && leist.length) {
      positionen = leist.map((p) => {
        const pos = {
          bezeichnung: (p.bezeichnung || 'Leistung') + (t.kennzeichen ? ' — ' + t.kennzeichen : '') + (p.zuschlag_netto > 0 && p.fahrzeugtyp ? ' (' + p.fahrzeugtyp + ')' : ''),
          menge: 1, einheit: null,
          mwst_satz: p.mwst_satz != null ? p.mwst_satz : 19,
          artikel_id: p.artikel_id || null
        };
        // Der Betrag, den der Kunde bei der Buchung gesehen hat, ist der BRUTTO-Zeilenbetrag.
        // Er wird unveraendert uebernommen. Wuerde man stattdessen die gespeicherten
        // Nettowerte addieren und wieder hochrechnen, verlaere jede Zeile bis zu einem Cent
        // (44,00 -> 36,97 -> 43,99), und bei mehreren Leistungen summiert sich das sichtbar.
        // Der Nettowert ist nur der Rueckfall fuer alte Buchungen ohne zeilen_brutto.
        const brutto = Number(p.zeilen_brutto);
        if (Number.isFinite(brutto) && brutto !== 0) pos.einzelpreis_brutto = round2(brutto);
        else pos.einzelpreis_netto = round2((Number(p.grundpreis_netto) || 0) + (Number(p.zuschlag_netto) || 0));
        // Der beim Buchen zugesagte Nachlasssatz ist je Leistung eingefroren. Er kann je
        // Position unterschiedlich sein (Flyer: 25 % auf die Einlagerung, 10 % auf den Rest) —
        // ein einziger Satz fuer den ganzen Beleg kann das nicht abbilden.
        const rab = Number(p.rabatt_prozent);
        if (Number.isFinite(rab) && rab > 0) pos.rabatt_prozent = rab;
        return pos;
      });
    } else {
      // Bei preise_inkl_mwst=true ist der Artikel-/Kundenpreis der zugesagte Endpreis: er wird als
      // Bruttopreis uebergeben und bleibt damit exakt erhalten (44,00 EUR bleiben 44,00 EUR).
      const basis = { bezeichnung: bez, menge: 1, einheit: t.artikel_einheit || null, mwst_satz: mwst, artikel_id: t.aid || null };
      positionen = [inkl
        ? Object.assign({}, basis, { einzelpreis_brutto: round2(preis) })
        : Object.assign({}, basis, { einzelpreis_netto: round2(preis) })];
    }
    // Nachlass. Vorrang, von oben nach unten:
    //  1) Saetze, die je Leistung im Termin EINGEFROREN sind (leistungen[].rabatt_prozent).
    //     Nur die koennen einen gestaffelten Gutschein abbilden (25 % auf die Einlagerung,
    //     10 % auf den Rest). Sie stammen aus dem Buchungsvorgang und sind eine Zusage an den
    //     Kunden — deshalb wird NICHT erneut live gegen die Gutscheintabelle geprueft.
    //  2) sonst ein manuell im Body mitgegebener Code (Kunde legt den Gutschein erst am Tresen
    //     vor). Der wird live geprueft und wirkt pauschal.
    //  3) sonst der pauschale Satz am Termin (termine.gutschein_rabatt) — Rueckfall fuer
    //     Buchungen, die noch keine Saetze je Position mitfuehren.
    const gCode = (req.body && req.body.gutschein_code || '').toString().trim();
    const eingefroren = nachlassPositionen(positionen, nachlassHerkunft);
    let rabattProzent = 0, rabattLabel = null, rabattQuelle = null;
    if (eingefroren.length) {
      // Ein zweiter Gutschein wuerde den Nachlass verdoppeln. Lieber klar ablehnen als still
      // eine der beiden Zusagen unterschlagen.
      if (gCode) return res.status(400).json({ error: 'Für diesen Termin ist bereits ein Nachlass hinterlegt. Ein weiterer Gutschein lässt sich nicht zusätzlich anwenden.' });
      positionen = positionen.concat(eingefroren);
      rabattQuelle = 'positionen';
      rabattLabel = nachlassHerkunft || 'Nachlass';
    } else if (gCode) {
      const g = (await query("SELECT code, rabatt_prozent FROM gutscheine WHERE UPPER(code)=UPPER($1) AND aktiv=true AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE)", [gCode])).rows[0];
      if (!g) return res.status(400).json({ error: 'Gutschein ungültig oder abgelaufen.' });
      rabattProzent = Number(g.rabatt_prozent) || 0;
      rabattLabel = 'Gutschein ' + g.code;
      rabattQuelle = 'body';
    } else if (Number(t.gutschein_rabatt) > 0) {
      rabattProzent = Number(t.gutschein_rabatt) || 0;
      rabattLabel = t.gutschein_code ? 'Gutschein ' + t.gutschein_code : 'Rabatt';
      rabattQuelle = 'termin';
    }
    rabattProzent = Math.min(Math.max(rabattProzent, 0), 100);
    if (rabattProzent > 0) {
      const basis = berechneSummen(positionen);
      positionen = positionen.concat(basis.mwst_aufschluesselung.filter((r) => r.netto > 0).map((r) => ({
        bezeichnung: rabattLabel + ' (-' + rabattProzent + ' %)', menge: 1, einheit: null,
        einzelpreis_netto: -round2(r.netto * rabattProzent / 100), mwst_satz: r.satz
      })));
    }
    // Auch die serverseitig gebauten Positionen laufen durch die Pruefung. Sie stammen aus
    // termine.leistungen bzw. dem Artikelstamm — sollte dort je etwas Unsinniges stehen, soll
    // daraus keine Rechnung entstehen (Sicherheitsnetz, kein erwarteter Fall).
    const terminPosFehler = pruefePositionen(positionen);
    if (terminPosFehler) return res.status(400).json({ error: 'Termin lässt sich nicht abrechnen — ' + terminPosFehler });
    const s = berechneSummen(positionen);
    // Empfaenger: bei Kundenkonto aus dem Stamm; sonst (Gast-Termin) Snapshot aus den Termin-Kontaktdaten,
    // OHNE einen Kundenstamm anzulegen ("nur Rechnungsempfaenger"). Die §14-Vollstaendigkeit (ab 250 EUR
    // volle Anschrift) wird wie gehabt erst beim Festschreiben geprueft; hier ist der Name das Minimum.
    let emp;
    if (t.kunden_id) {
      emp = await ladeEmpfaenger(t.kunden_id);
    } else {
      const s2 = (v) => (v == null ? null : String(v).trim() || null);
      const vorname = s2(t.kontakt_vorname), nachname = s2(t.kontakt_nachname);
      const name = ((vorname || '') + ' ' + (nachname || '')).trim() || s2(t.kontakt_name) || null;
      if (!name) return res.status(400).json({ error: 'Termin ohne Kundenkonto und ohne Empfängername — Rechnung bitte manuell anlegen.' });
      emp = {
        empfaenger_anrede: s2(t.kontakt_anrede), empfaenger_vorname: vorname, empfaenger_nachname: nachname,
        empfaenger_name: name, empfaenger_firma: null,
        empfaenger_strasse: s2(t.kontakt_strasse), empfaenger_plz: s2(t.kontakt_plz), empfaenger_ort: s2(t.kontakt_ort)
      };
    }
    const rdatum = heute();
    const result = await withTransaction(async (client) => {
      // Doppelabrechnung sicher ausschliessen: Die Vorpruefung oben liest ohne Sperre, zwischen
      // ihr und dem Schreiben liegen mehrere Abfragen. Deshalb den Termin hier sperren und die
      // Verknuepfung erneut pruefen — parallele Anfragen warten und laufen dann in den 409.
      const sperre = await client.query('SELECT rechnung_id FROM termine WHERE id=$1 FOR UPDATE', [t.id]);
      if (!sperre.rows.length) { const e = new Error('Termin nicht gefunden.'); e.status = 404; throw e; }
      if (sperre.rows[0].rechnung_id) { const e = new Error('Für diesen Termin wurde bereits eine Rechnung erstellt.'); e.status = 409; throw e; }
      const ins = await client.query(
        `INSERT INTO rechnungen
           (status, kunden_id, empfaenger_anrede, empfaenger_vorname, empfaenger_nachname, empfaenger_name, empfaenger_firma, empfaenger_strasse, empfaenger_plz, empfaenger_ort,
            empfaenger_land, rechnungsdatum, leistungsdatum, netto_summe, mwst_summe, brutto_summe, mwst_aufschluesselung, notizen, erstellt_von)
         VALUES ('entwurf',$1,$2,$3,$4,$5,$6,$7,$8,$9,$18,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [t.kunden_id, emp.empfaenger_anrede, emp.empfaenger_vorname, emp.empfaenger_nachname, emp.empfaenger_name, emp.empfaenger_firma, emp.empfaenger_strasse, emp.empfaenger_plz, emp.empfaenger_ort,
         rdatum, t.datum || rdatum, s.netto_summe, s.mwst_summe, s.brutto_summe, JSON.stringify(s.mwst_aufschluesselung), 'Aus Termin vom ' + (t.datum || ''), req.user.id, emp.empfaenger_land]
      );
      await insertPositionen(client, ins.rows[0].id, s.positionen);
      // Termin mit der Rechnung verknuepfen -> verhindert Doppelabrechnung
      await client.query('UPDATE termine SET rechnung_id=$1 WHERE id=$2', [ins.rows[0].id, t.id]);
      return ins.rows[0];
    });
    await auditLog({ userId: req.user.id, aktion: 'rechnung.aus_termin', tabelle: 'rechnungen', datensatzId: result.id, neueWerte: { termin_id: t.id, rabatt_quelle: rabattQuelle, rabatt_prozent: rabattProzent, rabatt_label: rabattLabel }, req });
    res.status(201).json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// ── PUT /:id ── Entwurf aendern (nur Entwurf)
router.put('/:id', async (req, res, next) => {
  try {
    const cur = await query('SELECT * FROM rechnungen WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (cur.rows[0].status !== 'entwurf') return res.status(400).json({ error: 'Nur Entwuerfe koennen bearbeitet werden.' });
    const { kunden_id, rechnungsdatum, leistungsdatum, notizen, positionen } = req.body;
    const posFehler = pruefePositionen(positionen);
    if (posFehler) return res.status(400).json({ error: posFehler });
    if (!datumPlausibel(rechnungsdatum)) return res.status(400).json({ error: 'Unplausibles Rechnungsdatum (Format JJJJ-MM-TT, Jahr ab 2020, nicht in der Zukunft).' });
    if (!datumPlausibel(leistungsdatum, true)) return res.status(400).json({ error: 'Unplausibles Leistungsdatum (Format JJJJ-MM-TT, Jahr ab 2020).' });
    // kunden_id ist explizit setzbar (auch auf null); fehlt das Feld ganz, bleibt die bisherige Verknuepfung
    const kid = (kunden_id !== undefined) ? (kunden_id || null) : cur.rows[0].kunden_id;
    const s = berechneSummen(positionen);
    // Empfaenger: explizite Eingabe (Snapshot) bevorzugen; sonst bei Kundenkonto aus dem Stamm laden.
    // Bei einem Gast-Entwurf (kein Kundenkonto) und ohne Empfaenger im Body den bereits gespeicherten
    // Snapshot der Zeile BEIBEHALTEN (nicht mit Leerwerten aus ladeEmpfaenger(null) ueberschreiben).
    let emp = empfaengerAusBody(req.body);
    if (!emp) {
      if (kid) {
        emp = await ladeEmpfaenger(kid);
      } else {
        const c = cur.rows[0];
        emp = {
          empfaenger_anrede: c.empfaenger_anrede, empfaenger_vorname: c.empfaenger_vorname, empfaenger_nachname: c.empfaenger_nachname,
          empfaenger_name: c.empfaenger_name, empfaenger_firma: c.empfaenger_firma,
          empfaenger_strasse: c.empfaenger_strasse, empfaenger_plz: c.empfaenger_plz, empfaenger_ort: c.empfaenger_ort,
          empfaenger_land: c.empfaenger_land
        };
      }
    }
    if (!emp.empfaenger_name && !emp.empfaenger_firma && !kid) {
      return res.status(400).json({ error: 'Bitte einen Kunden wählen oder einen Empfänger (Name oder Firma) eintragen.' });
    }
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE rechnungen SET kunden_id=$1, empfaenger_anrede=$2, empfaenger_vorname=$3, empfaenger_nachname=$4,
           empfaenger_name=$5, empfaenger_firma=$6, empfaenger_strasse=$7, empfaenger_plz=$8, empfaenger_ort=$9,
           empfaenger_land=$18, rechnungsdatum=$10, leistungsdatum=$11,
           netto_summe=$12, mwst_summe=$13, brutto_summe=$14, mwst_aufschluesselung=$15, notizen=$16
         WHERE id=$17`,
        [kid, emp.empfaenger_anrede, emp.empfaenger_vorname, emp.empfaenger_nachname, emp.empfaenger_name, emp.empfaenger_firma, emp.empfaenger_strasse, emp.empfaenger_plz, emp.empfaenger_ort,
         rechnungsdatum || cur.rows[0].rechnungsdatum, leistungsdatum || cur.rows[0].leistungsdatum,
         s.netto_summe, s.mwst_summe, s.brutto_summe, JSON.stringify(s.mwst_aufschluesselung), notizen || null, req.params.id, emp.empfaenger_land]
      );
      await client.query('DELETE FROM rechnung_positionen WHERE rechnung_id=$1', [req.params.id]);
      await insertPositionen(client, req.params.id, s.positionen);
    });
    await auditLog({ userId: req.user.id, aktion: 'rechnung.entwurf_geaendert', tabelle: 'rechnungen', datensatzId: req.params.id, req });
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
    // Ein aus einem Termin erzeugter Entwurf haengt per termine.rechnung_id am Termin (FK RESTRICT).
    // Beim Verwerfen des Entwurfs wird die Verknuepfung geloest, damit der Termin wieder abrechenbar ist.
    await withTransaction(async (client) => {
      // Auch das Kennzeichen 'fakturiert' zuruecknehmen: Das Frontend setzt es beim Erzeugen
      // der Rechnung. Bliebe es stehen, waere der Termin nach dem Verwerfen des Entwurfs als
      // abgerechnet markiert, ohne dass eine Rechnung existiert — er taucht dann weder in
      // "Abzurechnen" auf noch faellt er unter die Loeschfristen (die abgerechnete Termine
      // bewusst verschonen).
      await client.query('UPDATE termine SET rechnung_id=NULL, fakturiert=false WHERE rechnung_id=$1', [req.params.id]);
      await client.query('DELETE FROM rechnungen WHERE id=$1', [req.params.id]); // Positionen via ON DELETE CASCADE
    });
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
        empfaenger_strasse: rech.empfaenger_strasse, empfaenger_plz: rech.empfaenger_plz, empfaenger_ort: rech.empfaenger_ort,
        empfaenger_land: rech.empfaenger_land
      };

      // ── § 14 UStG: Pflichtangaben vor dem Festschreiben prüfen ──
      if (!emp.empfaenger_name && !emp.empfaenger_firma) {
        const e = new Error('Empfänger fehlt: bitte Name oder Firma angeben.'); e.status = 400; throw e;
      }
      if (!aussteller.steuernummer && !aussteller.ust_id) {
        const e = new Error('Bitte zuerst Steuernummer oder USt-IdNr. in den Einstellungen hinterlegen (§ 14 UStG).'); e.status = 400; throw e;
      }
      // Name und Anschrift des Ausstellers sind IMMER Pflicht (§ 14 Abs. 4 Nr. 1 UStG) —
      // die Kleinbetragsregelung (§ 33 UStDV) lockert nur die Empfaengerangaben.
      if (!aussteller.firmenname || !aussteller.strasse || !aussteller.plz || !aussteller.ort) {
        const e = new Error('Firmenname und vollständige Anschrift des Ausstellers fehlen — bitte in den Einstellungen vervollständigen (§ 14 UStG).'); e.status = 400; throw e;
      }
      // Eine angegebene USt-IdNr. muss formal gueltig sein. Eine deutsche hat DE und neun
      // Ziffern; steht dort etwas anderes, waere sie auf jeder Rechnung eine falsche
      // Pflichtangabe. Leer lassen ist erlaubt — dann traegt die Steuernummer die Angabe.
      if (aussteller.ust_id && !/^DE\s?\d{9}$/.test(String(aussteller.ust_id).replace(/\s/g, ' ').trim())) {
        const e = new Error('Die hinterlegte USt-IdNr. ist keine gültige deutsche Nummer (Format DE gefolgt von neun Ziffern). Bitte in den Einstellungen korrigieren oder das Feld leer lassen.'); e.status = 400; throw e;
      }
      // Solange eine Gesellschaft nicht im Handelsregister eingetragen ist — Einzelunternehmen,
      // GbR, oder eine Kapitalgesellschaft "i.G." vor der Eintragung — benennt die Firma allein
      // den Unternehmer nicht. Dann gehoert der Name der vertretungsberechtigten Person auf die
      // Rechnung. Bewusst exakter Abgleich gegen eine feste Liste: eine Teilstring-Suche wuerde
      // z. B. in "Fahrzeugtechnik" das "ug" finden und die Pflichtangabe still aushebeln.
      if (!REGISTER_RECHTSFORMEN.includes(String(aussteller.rechtsform || '').trim()) && !aussteller.inhaber) {
        const e = new Error('Name der vertretungsberechtigten Person fehlt (Inhaber bzw. Geschäftsführer) — bitte in den Einstellungen eintragen. Er ist der Name des leistenden Unternehmers (§ 14 UStG) und wird bei jeder Rechtsform verlangt, die nicht im Handelsregister eingetragen ist (Einzelunternehmen, GbR). Auch bei einer ungewöhnlichen Schreibweise der Rechtsform wird er sicherheitshalber verlangt.'); e.status = 400; throw e;
      }
      if (Number(rech.brutto_summe) > 250 && (!emp.empfaenger_strasse || !emp.empfaenger_plz || !emp.empfaenger_ort)) {
        const e = new Error('Für Rechnungen über 250 € ist die vollständige Anschrift des Empfängers Pflicht (Straße, PLZ, Ort — § 14 UStG).'); e.status = 400; throw e;
      }
      // Regelbesteuerung: nur 19 % und 7 %. Ein Satz von 0 % (oder ein unbekannter Satz) braucht
      // den Hinweis auf den Grund der Steuerbefreiung (§ 14 Abs. 4 Nr. 8 UStG), den das System
      // nicht fuehrt — solche Rechnungen werden daher nicht festgeschrieben.
      if (pos.some(function (p) { return !String(p.bezeichnung || '').trim(); })) {
        const e = new Error('Jede Position braucht eine Bezeichnung (Art der Leistung — § 14 Abs. 4 Nr. 5 UStG).'); e.status = 400; throw e;
      }
      const unzulaessig = pos.map(function (p) { return Number(p.mwst_satz); }).filter(function (x) { return x !== 19 && x !== 7; });
      if (unzulaessig.length) {
        const e = new Error('Unzulässiger Steuersatz (' + unzulaessig[0] + ' %). Vorgesehen sind 19 % und 7 %; für steuerfreie Leistungen fehlt der Pflichthinweis nach § 14 Abs. 4 Nr. 8 UStG.'); e.status = 400; throw e;
      }
      // Eine Rechnung über 0,00 € hat keinen Zweck und soll nicht festgeschrieben werden (Stornos laufen ueber /storno).
      if (Number(rech.brutto_summe) <= 0 && !rech.storno_von_id) {
        const e = new Error('Rechnung über 0,00 € kann nicht festgeschrieben werden. Bitte die Positionen prüfen.'); e.status = 400; throw e;
      }

      // ── Rechnungsdatum = Ausstellungsdatum = Serverdatum (Europe/Berlin) ──
      // GoBD / Audit S3: keine Rueck- oder Vordatierung. Der im Entwurf gespeicherte
      // Wunsch-Wert wird beim Festschreiben bewusst durch das echte Ausstellungsdatum
      // ersetzt. Dadurch ist die Reihenfolge Rechnungsnummer <-> Rechnungsdatum immer
      // monoton (spaetere Nummer nie aelteres Datum). Datumsmathematik in Postgres, um
      // die Zeitzonen-Verschiebung von new Date()/toISOString() zu vermeiden.
      // Zahlungsziel 0 (sofort faellig, z. B. Barzahlung) ist eine gueltige Einstellung —
      // deshalb kein "|| 14", das die 0 stillschweigend in 14 Tage verwandeln wuerde.
      const zztRoh = parseInt(einst.zahlungsziel_tage, 10);
      const zzt = Number.isFinite(zztRoh) && zztRoh >= 0 ? zztRoh : 14;
      const dq = await client.query(
        `SELECT to_char((now() AT TIME ZONE 'Europe/Berlin')::date,'YYYY-MM-DD') AS rdatum,
                EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Berlin')::date)::int AS jahr,
                to_char(((now() AT TIME ZONE 'Europe/Berlin')::date + ($1 * INTERVAL '1 day'))::date,'YYYY-MM-DD') AS faelligkeit,
                to_char(leistungsdatum,'YYYY-MM-DD') AS ldatum
         FROM rechnungen WHERE id=$2`,
        [zzt, req.params.id]
      );
      const fdaten = dq.rows[0];
      const rechnungsdatum = fdaten.rdatum;
      const jahr = fdaten.jahr;
      const faelligkeit = fdaten.faelligkeit;

      const cnt = await client.query(
        `INSERT INTO rechnung_counter (jahr, letzte_nr) VALUES ($1, 1)
         ON CONFLICT (jahr) DO UPDATE SET letzte_nr = rechnung_counter.letzte_nr + 1 RETURNING letzte_nr`,
        [jahr]
      );
      const nr = 'RE-' + jahr + '-' + String(cnt.rows[0].letzte_nr).padStart(4, '0');

      // Hinweis (bewusst so): Die PDF-Datei wird VOR dem abschliessenden UPDATE geschrieben.
      // Scheitert die Transaktion danach, wird die Nummer samt Zaehler zurueckgerollt, die
      // Datei bleibt aber unreferenziert liegen und wird beim naechsten Versuch derselben
      // Rechnung unter demselben Namen ueberschrieben. Kein Datenverlust und kein Beleg zu
      // wenig; der umgekehrte Weg (erst DB, dann PDF) koennte dagegen eine festgeschriebene
      // Rechnung ohne Beleg hinterlassen.
      const pdfPfad = await erzeugeRechnungPdf(
        Object.assign({}, rech, { rechnungsnr: nr, faelligkeit: faelligkeit, rechnungsdatum: rechnungsdatum, leistungsdatum: fdaten.ldatum, aussteller: aussteller, brutto_darstellung: einst.preise_inkl_mwst !== false }, emp),
        pos
      );

      const upd = await client.query(
        `UPDATE rechnungen SET rechnungsnr=$1, status='festgeschrieben', aussteller=$2,
           empfaenger_name=$3, empfaenger_firma=$4, empfaenger_strasse=$5, empfaenger_plz=$6, empfaenger_ort=$7,
           rechnungsdatum=$8, faelligkeit=$9, pdf_pfad=$10, festgeschrieben_am=NOW() WHERE id=$11 RETURNING *`,
        [nr, JSON.stringify(aussteller), emp.empfaenger_name, emp.empfaenger_firma, emp.empfaenger_strasse,
         emp.empfaenger_plz, emp.empfaenger_ort, rechnungsdatum, faelligkeit, pdfPfad, req.params.id]
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
router.post('/:id/storno', requireAdmin, async (req, res, next) => {
  try {
    const result = await withTransaction(async (client) => {
      const oRes = await client.query('SELECT * FROM rechnungen WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!oRes.rows.length) { const e = new Error('Rechnung nicht gefunden.'); e.status = 404; throw e; }
      const orig = oRes.rows[0];
      if (orig.status !== 'festgeschrieben') { const e = new Error('Nur festgeschriebene Rechnungen koennen storniert werden.'); e.status = 400; throw e; }
      // Eine Stornorechnung darf nicht selbst storniert werden (sonst entsteht eine positive "Storno-Storno"-Rechnung)
      if (orig.storno_von_id) { const e = new Error('Eine Stornorechnung kann nicht erneut storniert werden.'); e.status = 400; throw e; }
      const opos = (await client.query('SELECT * FROM rechnung_positionen WHERE rechnung_id=$1 ORDER BY position', [orig.id])).rows;

      const negPos = opos.map(function (p) {
        return { bezeichnung: 'Storno: ' + p.bezeichnung, menge: p.menge, einheit: p.einheit,
                 einzelpreis_netto: -Number(p.einzelpreis_netto), mwst_satz: p.mwst_satz, artikel_id: p.artikel_id,
                 spiegel_netto: -Number(p.zeilen_netto), spiegel_brutto: -Number(p.zeilen_brutto) };
      });
      const s = berechneSummen(negPos, true);

      const einst = (await client.query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
      const aussteller = ausstellerSnapshot(einst);
      // Storno-Datum = Serverdatum (Europe/Berlin), keine Rueckdatierung; Jahr daraus fuer den Nummernkreis.
      const dq = await client.query(
        `SELECT to_char((now() AT TIME ZONE 'Europe/Berlin')::date,'YYYY-MM-DD') AS d,
                EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Berlin')::date)::int AS jahr`
      );
      const rdatum = dq.rows[0].d;
      const jahr = dq.rows[0].jahr;
      const cnt = await client.query(
        `INSERT INTO rechnung_counter (jahr, letzte_nr) VALUES ($1, 1)
         ON CONFLICT (jahr) DO UPDATE SET letzte_nr = rechnung_counter.letzte_nr + 1 RETURNING letzte_nr`,
        [jahr]
      );
      const nr = 'RE-' + jahr + '-' + String(cnt.rows[0].letzte_nr).padStart(4, '0');

      const ins = await client.query(
        `INSERT INTO rechnungen
           (rechnungsnr, status, kunden_id, empfaenger_anrede, empfaenger_vorname, empfaenger_nachname, empfaenger_name, empfaenger_firma, empfaenger_strasse, empfaenger_plz, empfaenger_ort, empfaenger_land,
            aussteller, rechnungsdatum, leistungsdatum, netto_summe, mwst_summe, brutto_summe, mwst_aufschluesselung,
            zahlungsstatus, storno_von_id, festgeschrieben_am, erstellt_von, notizen)
         VALUES ($1,'festgeschrieben',$2,$3,$4,$5,$6,$7,$8,$9,$10,$21,$11,$12,$20,$13,$14,$15,$16,'bezahlt',$17,NOW(),$18,$19) RETURNING *`,
        [nr, orig.kunden_id, orig.empfaenger_anrede, orig.empfaenger_vorname, orig.empfaenger_nachname, orig.empfaenger_name, orig.empfaenger_firma, orig.empfaenger_strasse, orig.empfaenger_plz, orig.empfaenger_ort,
         JSON.stringify(aussteller), rdatum, s.netto_summe, s.mwst_summe, s.brutto_summe, JSON.stringify(s.mwst_aufschluesselung),
         orig.id, req.user.id, 'Storno zu ' + orig.rechnungsnr,
         // Leistungsdatum der Stornorechnung = Leistungszeitraum der Originalrechnung (nicht das Storno-Ausstellungsdatum)
         orig.leistungsdatum || rdatum, orig.empfaenger_land]
      );
      const storno = ins.rows[0];
      await insertPositionen(client, storno.id, s.positionen);
      // Eindeutiger Bezug zur Originalrechnung auf dem Beleg (Nummer + Datum), nicht nur als interne Notiz.
      const pdfPfad = await erzeugeRechnungPdf(
        Object.assign({}, storno, { aussteller: aussteller, storno_von_nr: orig.rechnungsnr, storno_von_datum: orig.rechnungsdatum, brutto_darstellung: einst.preise_inkl_mwst !== false }),
        s.positionen);
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

// ── POST /:id/barzahlung ── Zahlung am Tresen: an die Kasse melden und die Rechnung
// als bezahlt vermerken. Die Kasse bucht "Kasse an Forderungen" (Betragsart
// rechnungsausgleich, 0 %) — KEIN zweiter Erloes, denn Umsatz und Steuer sind bereits mit
// der Rechnung entstanden. Sie signiert den Vorgang (TSE) und gibt den Beleg aus.
router.post('/:id/barzahlung', async (req, res, next) => {
  try {
    const r = (await query('SELECT * FROM rechnungen WHERE id=$1', [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (r.status !== 'festgeschrieben') return res.status(400).json({ error: 'Nur festgeschriebene Rechnungen können kassiert werden.' });
    if (r.storno_von_id) return res.status(400).json({ error: 'Eine Stornorechnung wird nicht kassiert.' });
    if (r.zahlungsstatus === 'bezahlt') return res.status(409).json({ error: 'Diese Rechnung ist bereits als bezahlt vermerkt.' });
    if (!kasse.konfiguriert()) return res.status(503).json({ error: 'Die Kassenanbindung ist auf diesem Server nicht eingerichtet.' });

    const zahlart = ['bar', 'ec', 'stripe'].includes(String(req.body && req.body.zahlart || 'bar')) ? String(req.body.zahlart || 'bar') : null;
    if (!zahlart) return res.status(400).json({ error: 'Unbekannte Zahlart. Erlaubt sind bar, ec und stripe.' });

    let antwort;
    try {
      antwort = await kasse.meldeZahlung({
        quelleBeleg: r.rechnungsnr,
        ticket: r.rechnungsnr,
        betragArt: 'rechnungsausgleich',
        betrag: Number(r.brutto_summe),
        zahlart: zahlart,
        kunde: r.empfaenger_firma || r.empfaenger_name || null
      });
    } catch (e) {
      // Bewusst NICHT als bezahlt markieren, wenn die Kasse den Vorgang nicht angenommen hat.
      // Sonst stuende die Rechnung auf bezahlt, ohne dass das Geld im Kassenbuch auftaucht.
      if (e.code === 'NICHT_ERREICHBAR') {
        return res.status(502).json({ error: 'Die Kasse ist nicht erreichbar. Die Rechnung wurde NICHT als bezahlt markiert.' });
      }
      // 409: In der Kasse liegt bereits ein offener Vorgang zu dieser Rechnung, mit anderen
      // Daten — etwa weil zuerst bar versucht wurde und jetzt mit Karte. Die Kasse laesst
      // das bewusst nicht still ueberschreiben. Der Vorgang muss dort abgeschlossen oder
      // abgelehnt werden.
      if (e.status === 409) {
        return res.status(409).json({ error: 'Zu dieser Rechnung liegt in der Kasse bereits ein offener Vorgang mit anderen Angaben. Bitte ihn dort abschließen oder ablehnen und danach erneut kassieren.' });
      }
      // 403: Die Kasse laesst die Betragsart nicht zu, weil das noetige Modul fehlt.
      if (e.status === 403) {
        return res.status(400).json({ error: 'Die Kasse nimmt den Forderungsausgleich nicht an — das Modul „Forderungen" ist dort nicht aktiv. Das ist eine Einstellung der Kasse.' });
      }
      return res.status(400).json({ error: 'Die Kasse hat den Vorgang abgelehnt: ' + e.message });
    }

    // Bargeld ab 10.000 EUR verlangt eine Identifizierung nach dem Geldwaeschegesetz. Die
    // Kasse laesst den Vorgang dann bewusst offen — hier darf nichts als bezahlt gelten.
    if (antwort && antwort.gwgErforderlich) {
      return res.status(409).json({ error: 'Betrag über der Geldwäsche-Schwelle: Der Vorgang liegt in der Kasse und muss dort mit Identitätsnachweis bestätigt werden.' });
    }

    const beleg = kasse.belegAus(antwort);
    const upd = await query(
      `UPDATE rechnungen SET zahlungsstatus='bezahlt', bezahlt_am=(now() AT TIME ZONE 'Europe/Berlin')::date,
         kasse_beleg_nr=$1, kasse_beleg_datum=(now() AT TIME ZONE 'Europe/Berlin')::date, kasse_beleg_url=$2
       WHERE id=$3 AND zahlungsstatus<>'bezahlt' RETURNING *`,
      [beleg, (antwort && antwort.belegUrl) || null, req.params.id]);

    await auditLog({ userId: req.user.id, aktion: 'rechnung.barzahlung', tabelle: 'rechnungen', datensatzId: r.id,
      neueWerte: { zahlart: zahlart, kassenbeleg: beleg, bereits_verarbeitet: !!(antwort && antwort.bereitsVerarbeitet) }, req });
    // Kein Treffer heisst: Ein zweiter Vorgang war schneller und hat die Rechnung bereits
    // ausgeglichen. Die Kasse hat dank Idempotenz nur einmal gebucht, hier ist also nichts
    // kaputt — aber ein 200 mit leerem Rechnungssatz wuerde einen Erfolg vortaeuschen, den
    // dieser Aufruf nicht hatte.
    if (!upd.rows.length) {
      return res.status(409).json({ error: 'Die Rechnung wurde zwischenzeitlich bereits als bezahlt erfasst.' });
    }
    res.json(Object.assign({}, upd.rows[0], {
      hinweis: beleg
        ? 'In der Kasse gebucht, Kassenbeleg ' + beleg + '.'
        : 'In der Kasse gebucht. Die Belegnummer wird beim nächsten Abgleich nachgetragen.'
    }));
  } catch (e) { next(e); }
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
      `SELECT r.*, k.rechnung_email AS k_rechnung_email, k.email AS k_email, k.portal_email, k.vorname
       FROM rechnungen r LEFT JOIN kunden k ON k.id = r.kunden_id WHERE r.id = $1`,
      [req.params.id]
    )).rows[0];
    if (!r) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (r.status !== 'festgeschrieben' || r.zahlungsstatus !== 'offen') {
      return res.status(400).json({ error: 'Nur offene, festgeschriebene Rechnungen können gemahnt werden.' });
    }
    // Mahnungen gehen an die Rechnungsadresse, wenn es eine gibt — sonst an die allgemeine.
    const mail = r.k_rechnung_email || r.k_email || r.portal_email;
    if (!mail) return res.status(400).json({ error: 'Für diesen Kunden ist keine E-Mail hinterlegt.' });

    // Gemahnt wird erst nach Faelligkeit und mit Mindestabstand zwischen den Stufen — sonst koennte
    // ein versehentlicher Doppelklick den Kunden mehrfach anschreiben und die Mahnstufe hochtreiben.
    const frist = (await query(
      `SELECT COALESCE(CURRENT_DATE < faelligkeit, false) AS zu_frueh,
              COALESCE(CURRENT_DATE < mahnung_am + ($1 * INTERVAL '1 day'), false) AS zu_dicht,
              to_char((mahnung_am + ($1 * INTERVAL '1 day'))::date, 'DD.MM.YYYY') AS naechste
       FROM rechnungen WHERE id=$2`, [MAHN_ABSTAND_TAGE, req.params.id])).rows[0];
    if (frist.zu_frueh) return res.status(400).json({ error: 'Die Rechnung ist noch nicht fällig.' });
    if (frist.zu_dicht) return res.status(400).json({ error: 'Zuletzt wurde bereits gemahnt. Die nächste Mahnung ist ab ' + frist.naechste + ' möglich.' });

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
    try {
      await sendMail({ to: mail, subject: betreff + ' — Rechnung ' + r.rechnungsnr, html: html, typ: 'mahnung', bezugId: r.id });
    } catch (mailErr) {
      return res.status(502).json({ error: 'Mahnung konnte nicht versendet werden. Bitte E-Mail-Adresse prüfen.' });
    }
    await query('UPDATE rechnungen SET mahnstufe=$1, mahnung_am=CURRENT_DATE WHERE id=$2', [stufe, r.id]);
    await auditLog({ userId: req.user.id, aktion: 'rechnung.mahnung', tabelle: 'rechnungen', datensatzId: r.id, neueWerte: { mahnstufe: stufe }, req });
    res.json({ message: betreff + ' gesendet.', mahnstufe: stufe });
  } catch (e) { next(e); }
});

// ── POST /:id/senden ── Festgeschriebene Rechnung als PDF per E-Mail an den Kunden senden
router.post('/:id/senden', async (req, res, next) => {
  try {
    const r = (await query('SELECT * FROM rechnungen WHERE id=$1', [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Rechnung nicht gefunden.' });
    if (r.status !== 'festgeschrieben') return res.status(400).json({ error: 'Nur festgeschriebene Rechnungen können versendet werden.' });
    let mail = (req.body && req.body.email) ? String(req.body.email).trim() : null;
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ error: 'Die angegebene E-Mail-Adresse ist ungültig.' });
    if (!mail && r.kunden_id) {
      // Vorrang: eigene Rechnungsadresse (Buchhaltung), dann die allgemeine Adresse.
      const k = (await query('SELECT rechnung_email, email, portal_email FROM kunden WHERE id=$1', [r.kunden_id])).rows[0];
      mail = k ? (k.rechnung_email || k.email || k.portal_email) : null;
    }
    if (!mail) return res.status(400).json({ error: 'Keine E-Mail-Adresse für den Empfänger hinterlegt.' });
    if (!r.pdf_pfad || !fs.existsSync(r.pdf_pfad)) return res.status(400).json({ error: 'Rechnungs-PDF nicht gefunden.' });
    const einst = (await query('SELECT * FROM einstellungen LIMIT 1')).rows[0] || {};
    const firma = einst.firmenname || 'Schröder & Scholz';
    await sendMail({
      to: mail,
      subject: 'Ihre Rechnung ' + r.rechnungsnr + ' — ' + firma,
      typ: 'rechnung', bezugId: r.id,
      // Der Empfaengername ist ein beim Festschreiben eingefrorener Freitext. Ungeschuetzt in
      // HTML gesetzt koennte er die Mail umbauen — deshalb hier dasselbe esc() wie in den
      // Portalmails.
      html: '<p>Guten Tag' + (r.empfaenger_name ? ' ' + esc(r.empfaenger_name) : '') + ',</p>' +
        '<p>anbei erhalten Sie Ihre Rechnung <strong>' + esc(r.rechnungsnr) + '</strong> über <strong>' +
        (Number(r.brutto_summe) || 0).toFixed(2).replace('.', ',') + ' €</strong> als PDF-Anhang.</p>' +
        '<p>Mit freundlichen Grüßen,<br>' + esc(firma) + '</p>',
      attachments: [{ filename: r.rechnungsnr + '.pdf', path: r.pdf_pfad }]
    });
    await auditLog({ userId: req.user.id, aktion: 'rechnung.versendet', tabelle: 'rechnungen', datensatzId: r.id, neueWerte: { email: mail }, req });
    res.json({ message: 'Rechnung an ' + mail + ' gesendet.' });
  } catch (e) {
    return res.status(502).json({ error: 'Rechnung konnte nicht versendet werden. Bitte E-Mail-Adresse prüfen.' });
  }
});

module.exports = router;
