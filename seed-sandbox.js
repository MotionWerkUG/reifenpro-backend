'use strict';
// SANDBOX-SEED: legt Testdaten an (Kunden, Fahrzeuge, 100 Einlagerungen, Termine,
// Rechnungen via echte API, 1 Portal-Testlogin). Vor dem Go-live mit reset-sandbox.sql entfernen.
// Ausfuehren im Backend-Root:  node seed-sandbox.js
require('dotenv').config({ path: __dirname + '/.env' });
const { query } = require('./src/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const ADMIN_ID = '89888479-d4ab-4686-9751-edd447eb7b80';
const API = 'http://127.0.0.1:' + (process.env.PORT || 3001) + '/api';
const TEST_EMAIL = 'testkunde@schroeder-scholz.de';
const TEST_PW = 'Testkunde2026!';

const VORNAMEN = ['Andreas','Birgit','Christian','Daniela','Erik','Franziska','Georg','Hannah','Ingo','Julia','Klaus','Lena','Martin','Nina','Oliver','Petra','Quirin','Renate','Stefan','Tanja','Ulrich','Verena','Wolfgang','Yvonne','Zacharias','Bettina','Florian','Gabriele','Heinz','Katrin'];
const NACHNAMEN = ['Bauer','Huber','Wagner','Mayer','Fischer','Weber','Schmid','Lehmann','Koch','Richter','Wolf','Schäfer','Neumann','Schwarz','Zimmermann','Braun','Krüger','Hofmann','Hartmann','Lang','Brandl','Sedlmaier','Forster','Eder','Gruber','Reiter','Stadler','Wimmer','Bergmann','Vogel'];
const ORTE = [['Penzberg','82377'],['Wolfratshausen','82515'],['Bad Tölz','83646'],['Geretsried','82538'],['Iffeldorf','82393'],['Benediktbeuern','83671'],['Kochel am See','82431'],['Seeshaupt','82402']];
const STRASSEN = ['Bahnhofstraße','Hauptstraße','Lindenweg','Bergstraße','Am Anger','Karwendelstraße','Isarweg','Schulstraße','Ahornallee','Münchner Straße'];
const MARKEN_KFZ = [['VW','Golf','PKW'],['BMW','3er','PKW'],['Audi','A4','PKW'],['Mercedes','C-Klasse','PKW'],['VW','Tiguan','SUV'],['BMW','X3','SUV'],['Audi','Q5','SUV'],['Ford','Transit','Transporter'],['Mercedes','Sprinter','Transporter'],['Skoda','Octavia','PKW'],['Opel','Astra','PKW'],['Toyota','RAV4','SUV']];
const REIFENMARKEN = ['Continental','Michelin','Goodyear','Bridgestone','Pirelli','Dunlop','Hankook','Vredestein'];
const GROESSEN = ['195/65 R15 91T','205/55 R16 91V','225/45 R17 94W','205/60 R16 96H','235/55 R18 100V','215/65 R16 98H','225/40 R18 92Y','185/65 R15 88T'];
const TYPEN = ['Winter','Sommer','Ganzjahr'];
const FELGEN = ['Alufelge','Stahlfelge','ohne Felgen'];
const KFZ_BUCHST = ['AB','CD','EF','GH','MX','TS','LK','RP','VW','BN'];

function pad(n) { return String(n).padStart(2, '0'); }
function r(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function ri(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function dstr(offsetDays) { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

let platzIdx = 0;
const REGALE = ['A','B','C','D','E','F','G','H','I','J'];
function naechsterPlatz() {
  // A-01-01, A-01-02 ... eindeutig
  var regal = REGALE[Math.floor(platzIdx / 100)];
  var rest = platzIdx % 100;
  var reihe = Math.floor(rest / 10) + 1;
  var platz = (rest % 10) + 1;
  platzIdx++;
  return regal + '-' + pad(reihe) + '-' + pad(platz);
}

async function main() {
  console.log('Seed startet …');
  const hash = await bcrypt.hash(TEST_PW, 12);
  const kunden = [];

  // 30 Kunden (Index 0 = Testkunde mit Portal-Login)
  for (let i = 0; i < 30; i++) {
    const ist = i === 0;
    const vor = ist ? 'Max' : r(VORNAMEN);
    const nach = ist ? 'Mustermann' : r(NACHNAMEN);
    const [ort, plz] = r(ORTE);
    const anrede = Math.random() < 0.5 ? 'Herr' : 'Frau';
    const kfz = r(MARKEN_KFZ);
    const kennz = 'WOR-' + r(KFZ_BUCHST) + '-' + ri(10, 9999);
    const email = ist ? TEST_EMAIL : (vor + '.' + nach + i).toLowerCase().replace(/[äöü ]/g, '') + '@example.com';
    const nr = (await query("SELECT nextval('seq_kunden_nr') AS n")).rows[0].n;
    const kundenNr = 'K-' + pad(nr).padStart(4, '0');
    const row = (await query(
      `INSERT INTO kunden
        (kunden_nr, anrede, vorname, nachname, strasse, plz, ort, telefon, email, kennzeichen,
         fahrzeug_marke, fahrzeug_modell, fahrzeug_typ, baujahr, aktiv,
         portal_aktiv, portal_email, portal_password, portal_email_bestaetigt, portal_freigegeben, portal_verifiziert,
         portal_agb_akzeptiert, portal_dsgvo_akzeptiert, einwilligung_saison_erinnerung, portal_registriert_am, erstellt_am)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,
         $15,$16,$17,$18,$19,true,true,true,true, NOW(), NOW())
       RETURNING id`,
      [kundenNr, anrede, vor, nach, r(STRASSEN) + ' ' + ri(1, 99), plz, ort, '0' + ri(150, 179) + ' ' + ri(1000000, 9999999),
       email, kennz, kfz[0], kfz[1], kfz[2], ri(2008, 2023),
       ist, ist ? TEST_EMAIL : null, ist ? hash : null, ist, ist]
    )).rows[0];
    // Fahrzeug
    const fz = (await query(
      `INSERT INTO fahrzeuge (kunden_id, typ, marke, modell, kennzeichen, baujahr, hu_datum, erstellt_am)
       VALUES ($1,$2,$3,$4,$5,$6,$7, NOW()) RETURNING id`,
      [row.id, kfz[2], kfz[0], kfz[1], kennz, ri(2008, 2023), dstr(ri(30, 700))]
    )).rows[0];
    kunden.push({ id: row.id, fz: fz.id, name: vor + ' ' + nach, nr: kundenNr });
  }
  console.log(kunden.length + ' Kunden + Fahrzeuge angelegt (Testkunde: ' + TEST_EMAIL + ')');

  // 100 Einlagerungen
  const statusVert = [];
  for (let i = 0; i < 78; i++) statusVert.push('Eingelagert');
  for (let i = 0; i < 12; i++) statusVert.push('Abholbereit');
  for (let i = 0; i < 10; i++) statusVert.push('Abgeholt');
  for (let i = 0; i < 100; i++) {
    const k = (i < 4) ? kunden[0] : r(kunden); // Testkunde bekommt mind. 4
    const status = statusVert[i];
    const eingel = dstr(-ri(10, 400));
    const beleg = (await query("SELECT nextval('seq_beleg_nr') AS n")).rows[0].n;
    await query(
      `INSERT INTO einlagerungen
        (beleg_nr, kunden_id, fahrzeug_id, reifen_groesse, reifen_typ, reifen_marke, anzahl, felgen, dot,
         profil_vl, profil_vr, profil_hl, profil_hr, lagerplatz, status, eingelagert_am,
         abholbereit_am, abgeholt_am, erstellt_von, erstellt_am)
       VALUES ($1,$2,$3,$4,$5,$6,4,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, NOW())`,
      ['E-' + pad(beleg).padStart(4, '0'), k.id, k.fz, r(GROESSEN), r(TYPEN), r(REIFENMARKEN),
       r(FELGEN), ri(15, 22) + pad(ri(18, 24)), (ri(30, 80) / 10), (ri(30, 80) / 10), (ri(30, 80) / 10), (ri(30, 80) / 10),
       naechsterPlatz(), status, eingel,
       status === 'Abholbereit' || status === 'Abgeholt' ? new Date().toISOString() : null,
       status === 'Abgeholt' ? new Date().toISOString() : null, ADMIN_ID]
    );
  }
  console.log('100 Einlagerungen angelegt');

  // Artikel laden (fuer Termine)
  const artikel = (await query('SELECT id, name FROM artikel WHERE aktiv IS NOT false')).rows;

  // ~40 Termine: Vergangenheit (abgeschlossen), Zukunft (bestaetigt), einige angefragt/storniert
  let tCount = 0;
  for (let i = 0; i < 40; i++) {
    const k = (i < 3) ? kunden[0] : r(kunden);
    const a = r(artikel);
    let status, datum, portal = false;
    if (i < 18) { status = 'abgeschlossen'; datum = dstr(-ri(1, 90)); }
    else if (i < 33) { status = 'bestaetigt'; datum = dstr(ri(1, 30)); }
    else if (i < 37) { status = 'angefragt'; datum = dstr(ri(1, 21)); portal = true; }
    else { status = 'storniert'; datum = dstr(ri(1, 20)); }
    const h = ri(8, 16);
    await query(
      `INSERT INTO termine
        (kunden_id, fahrzeug_id, kontakt_name, kontakt_telefon, kontakt_email, datum, uhrzeit_von, uhrzeit_bis,
         termin_typ, artikel_id, kennzeichen, status, portal_buchung, erstellt_am)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())`,
      [k.id, k.fz, k.name, '0' + ri(150, 179) + ' ' + ri(1000000, 9999999), null, datum,
       pad(h) + ':00', pad(h) + ':30', a.name, a.id, 'WOR-' + r(KFZ_BUCHST) + '-' + ri(10, 9999), status, portal]
    );
    tCount++;
  }
  console.log(tCount + ' Termine angelegt');

  // RECHNUNGEN ueber die echte API (fortlaufende Nummer + PDF + Festschreibung)
  const token = jwt.sign({ userId: ADMIN_ID }, process.env.JWT_SECRET, { expiresIn: '2h' });
  const H = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

  const specs = [
    { k: 0, tage: 35, pos: [{ bezeichnung: 'Räderwechsel inkl. Auswuchten', menge: 1, einheit: 'Pauschale', einzelpreis_netto: 39.00, mwst_satz: 19 }], aktion: 'ueberfaellig' },
    { k: 0, tage: 8, pos: [{ bezeichnung: 'Reifeneinlagerung Saison', menge: 1, einheit: 'Saison', einzelpreis_netto: 45.00, mwst_satz: 19 }], aktion: 'bezahlt' },
    { k: 1, tage: 5, pos: [{ bezeichnung: 'Sommerreifen 205/55 R16 Continental', menge: 4, einheit: 'Stück', einzelpreis_netto: 95.00, mwst_satz: 19 }, { bezeichnung: 'Montage und Wuchten', menge: 4, einheit: 'Stück', einzelpreis_netto: 12.50, mwst_satz: 19 }], aktion: 'offen' },
    { k: 2, tage: 3, pos: [{ bezeichnung: 'Reifenwechsel', menge: 1, einheit: 'Pauschale', einzelpreis_netto: 35.00, mwst_satz: 19 }, { bezeichnung: 'Ventil erneuern', menge: 4, einheit: 'Stück', einzelpreis_netto: 4.50, mwst_satz: 19 }], aktion: 'offen' },
    { k: 3, tage: 1, pos: [{ bezeichnung: 'TPMS-Sensor inkl. Anlernen', menge: 4, einheit: 'Stück', einzelpreis_netto: 49.00, mwst_satz: 19 }], aktion: 'offen' },
    { k: 4, tage: 20, pos: [{ bezeichnung: 'Komplettradsatz Winter inkl. Montage', menge: 1, einheit: 'Satz', einzelpreis_netto: 520.00, mwst_satz: 19 }], aktion: 'bezahlt' },
    { k: 5, tage: 0, pos: [{ bezeichnung: 'Räderwechsel inkl. Auswuchten', menge: 1, einheit: 'Pauschale', einzelpreis_netto: 39.00, mwst_satz: 19 }], aktion: 'entwurf' }
  ];

  let ok = 0;
  for (const sp of specs) {
    try {
      const kunde = kunden[sp.k];
      const rdatum = dstr(-sp.tage);
      const cr = await fetch(API + '/rechnungen', { method: 'POST', headers: H, body: JSON.stringify({ kunden_id: kunde.id, rechnungsdatum: rdatum, leistungsdatum: rdatum, notizen: 'Sandbox-Testrechnung', positionen: sp.pos }) });
      const draft = await cr.json();
      if (!cr.ok) { console.log('  Rechnung-Entwurf Fehler:', draft.error); continue; }
      if (sp.aktion === 'entwurf') { ok++; continue; }
      const fs = await fetch(API + '/rechnungen/' + draft.id + '/festschreiben', { method: 'POST', headers: H });
      const fr = await fs.json();
      if (!fs.ok) { console.log('  Festschreiben Fehler:', fr.error); continue; }
      if (sp.aktion === 'bezahlt') {
        await query("UPDATE rechnungen SET zahlungsstatus='bezahlt', bezahlt_am=NOW() WHERE id=$1", [draft.id]);
      }
      ok++;
    } catch (e) { console.log('  Rechnung Fehler:', e.message); }
  }
  console.log(ok + '/' + specs.length + ' Rechnungen angelegt');
  console.log('\nFERTIG. Portal-Testlogin:  ' + TEST_EMAIL + '  /  ' + TEST_PW);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
