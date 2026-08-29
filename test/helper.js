'use strict';
// Gemeinsame Testumgebung fuer das Rechnungswesen.
//
// Grundsatz: Tests laufen AUSSCHLIESSLICH gegen die Test-Datenbank (Standard
// 'reifenpro_test', Schema 1:1 aus der Produktivdatenbank — siehe scripts/test-db-setup.sh).
// Weder der produktive Nummernkreis noch der aufbewahrungspflichtige Belegordner
// 'rechnungen/' werden beruehrt: erzeugte PDFs landen in einem temporaeren Ordner.
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// Muss VOR dotenv gesetzt werden (dotenv ueberschreibt bereits gesetzte Variablen nicht):
// nur im Testbetrieb darf die PDF-Ablage ueber RECHNUNGEN_DIR umgelenkt werden.
process.env.NODE_ENV = 'test';
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PROD_DB = process.env.DB_NAME || 'reifenpro';
const TEST_DB = process.env.TEST_DB_NAME || 'reifenpro_test';
if (TEST_DB === PROD_DB || !/test/i.test(TEST_DB)) {
  throw new Error('Sicherheitsstopp: Test-Datenbank "' + TEST_DB + '" ist nicht als Testdatenbank erkennbar.');
}
// MUSS vor dem Laden von src/db/index.js gesetzt sein (Pool wird beim require gebaut).
process.env.DB_NAME = TEST_DB;
const PDF_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reifenpro-test-pdf-'));
process.env.RECHNUNGEN_DIR = PDF_DIR;

const express = require('express');
const jwt     = require('jsonwebtoken');
const { query, pool } = require('../src/db/index');

let server = null;
let basisUrl = null;

// Startet die Rechnungs-Routen auf einem freien Port. Bewusst nur der Router
// (kein server.js): kein Cron, kein Rate-Limit, keine Mail-Zustellung im Test.
async function starteApp() {
  if (basisUrl) return basisUrl;
  const db = (await query('SELECT current_database() AS db')).rows[0].db;
  if (db !== TEST_DB) throw new Error('Sicherheitsstopp: verbunden mit "' + db + '" statt "' + TEST_DB + '".');

  const app = express();
  app.use(express.json());
  app.use('/api/rechnungen', require('../src/routes/rechnungen'));
  await new Promise(function (ok) { server = app.listen(0, '127.0.0.1', ok); });
  basisUrl = 'http://127.0.0.1:' + server.address().port;
  return basisUrl;
}

async function stoppeApp() {
  if (server) { await new Promise(function (ok) { server.close(ok); }); server = null; basisUrl = null; }
  await pool.end();
  fs.rmSync(PDF_DIR, { recursive: true, force: true });
}

// Leert alle im Rechnungswesen beteiligten Tabellen. TRUNCATE loest keine
// Row-Trigger aus, der GoBD-Schutztrigger blockiert das Aufraeumen also nicht.
async function leereDaten() {
  await query(`TRUNCATE rechnung_positionen, rechnungen, rechnung_counter, termine,
               kunden, einstellungen, audit_log, users RESTART IDENTITY CASCADE`);
}

// Legt die Mindestbasis an: Einstellungen (Aussteller) + ein Mitarbeiterkonto mit Token.
async function seedBasis(opt) {
  const o = opt || {};
  await query(
    `INSERT INTO einstellungen (firmenname, inhaber, strasse, plz, ort, steuernummer, ust_id,
                                zahlungsziel_tage, preise_inkl_mwst)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [o.firmenname || 'Testbetrieb Rechnungswesen', 'Test Inhaber', 'Teststrasse 1', '12345', 'Teststadt',
     o.steuernummer !== undefined ? o.steuernummer : '123/456/78901',
     o.ust_id !== undefined ? o.ust_id : null,
     o.zahlungsziel_tage !== undefined ? o.zahlungsziel_tage : 14,
     o.preise_inkl_mwst !== undefined ? o.preise_inkl_mwst : false]
  );
  const u = await query(
    `INSERT INTO users (email, password, vorname, nachname, rolle, aktiv)
     VALUES ($1,'x','Test','Nutzer',$2,true) RETURNING id`,
    [o.email || 'test-rechnungswesen@intern.local', o.rolle || 'admin']
  );
  const userId = u.rows[0].id;
  return { userId: userId, token: jwt.sign({ userId: userId }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
}

// Testkunde (frei erfundene Daten — keine echten Kundendaten in Tests).
async function seedKunde(opt) {
  const o = opt || {};
  // kunden_nr ist NOT NULL und im Betrieb fortlaufend; im Test genuegt ein eindeutiger Wert.
  const nr = (await query("SELECT 'T-' || LPAD((COUNT(*)+1)::text, 4, '0') AS nr FROM kunden")).rows[0].nr;
  const r = await query(
    `INSERT INTO kunden (kunden_nr, anrede, vorname, nachname, strasse, plz, ort, land, rechnung_email, email)
     VALUES ($7,$1,$2,$3,$4,$5,$6,$8,$9,$10) RETURNING id`,
    [o.anrede || 'Herr', o.vorname || 'Max', o.nachname || 'Mustermann',
     o.strasse !== undefined ? o.strasse : 'Musterweg 2',
     o.plz !== undefined ? o.plz : '54321',
     o.ort !== undefined ? o.ort : 'Musterstadt', o.kunden_nr || nr,
     o.land !== undefined ? o.land : null,
     o.rechnung_email !== undefined ? o.rechnung_email : null,
     o.email !== undefined ? o.email : null]
  );
  return r.rows[0].id;
}

// Zusaetzliches Benutzerkonto (z. B. 'mitarbeiter') fuer Berechtigungstests.
async function seedNutzer(rolle, email) {
  const u = await query(
    `INSERT INTO users (email, password, vorname, nachname, rolle, aktiv)
     VALUES ($1,'x','Test','Nutzer',$2,true) RETURNING id`,
    [email || rolle + '-test@intern.local', rolle]);
  const id = u.rows[0].id;
  return { userId: id, token: jwt.sign({ userId: id }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
}

// Text eines PDFs lesen; null, wenn pdftotext (poppler-utils) nicht installiert ist.
function pdfText(pfad) {
  try { return require('node:child_process').execFileSync('pdftotext', ['-layout', pfad, '-']).toString(); }
  catch (e) { return null; }
}

// Aktuelles Jahr aus Sicht des Servers (Europe/Berlin) — genau die Quelle, aus der auch
// der Nummernkreis sein Jahr zieht. Vermeidet Abweichungen zur lokalen Node-Zeit.
async function serverJahr() {
  const r = await query("SELECT EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Berlin')::date)::int AS j");
  return r.rows[0].j;
}

// Kleiner HTTP-Helfer: liefert immer { status, body }.
async function api(token, methode, pfad, koerper) {
  const res = await fetch(basisUrl + pfad, {
    method: methode,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: koerper === undefined ? undefined : JSON.stringify(koerper)
  });
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  return { status: res.status, body: body };
}

module.exports = { starteApp, stoppeApp, leereDaten, seedBasis, seedKunde, seedNutzer, serverJahr, pdfText, api, query, PDF_DIR, TEST_DB };
