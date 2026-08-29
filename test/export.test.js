'use strict';
// Exporte fuer die Buchhaltung (Rechnungsjournal-CSV, DATEV-EXTF-Buchungsstapel) und
// die Funktionstrennung: Storno und Exporte sind Admin-Sache, nicht Mitarbeiter-Sache.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');

let token, jahr;

test.before(async () => { await h.starteApp(); });
test.after(async () => { await h.stoppeApp(); });
test.beforeEach(async () => {
  await h.leereDaten();
  const b = await h.seedBasis();
  token = b.token;
  jahr = await h.serverJahr();
});

const EMPF = { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg 2', plz: '54321', ort: 'Musterstadt' };

async function festgeschriebeneRechnung(positionen) {
  const e = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    positionen: positionen || [{ bezeichnung: 'Raederwechsel', menge: 1, einheit: 'Stk', einzelpreis_netto: 100, mwst_satz: 19 }]
  });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  return f.body;
}

test('Rechnungsjournal-CSV enthaelt jede festgeschriebene Rechnung genau einmal', async () => {
  const r1 = await festgeschriebeneRechnung();
  const r2 = await festgeschriebeneRechnung();
  const csv = await h.api(token, 'GET', '/api/rechnungen/export?jahr=' + jahr);
  assert.equal(csv.status, 200);
  const zeilen = String(csv.body).trim().split(/\r?\n/);
  assert.equal(zeilen.length, 3, 'Kopfzeile + zwei Rechnungen');
  assert.ok(zeilen[1].includes(r1.rechnungsnr) || zeilen[2].includes(r1.rechnungsnr));
  assert.ok(zeilen[1].includes(r2.rechnungsnr) || zeilen[2].includes(r2.rechnungsnr));
  assert.ok(zeilen[0].includes('Rechnungsnr') && zeilen[0].includes('Netto') && zeilen[0].includes('Brutto'));
});

test('Entwuerfe tauchen im Journal nicht auf', async () => {
  await h.api(token, 'POST', '/api/rechnungen', { empfaenger: EMPF, positionen: [{ bezeichnung: 'Entwurf', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
  const csv = await h.api(token, 'GET', '/api/rechnungen/export?jahr=' + jahr);
  assert.equal(String(csv.body).trim().split(/\r?\n/).length, 1, 'nur die Kopfzeile');
});

test('DATEV-Export bucht je Steuersatz eine Zeile auf das passende Erloeskonto', async () => {
  const r = await festgeschriebeneRechnung([
    { bezeichnung: 'Arbeit', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 },
    { bezeichnung: 'Ware', menge: 1, einzelpreis_netto: 50, mwst_satz: 7 }
  ]);
  const csv = await h.api(token, 'GET', '/api/rechnungen/export-datev?jahr=' + jahr);
  assert.equal(csv.status, 200);
  // Hinweis: Das Byte-Order-Mark, das die Route voranstellt, entfernt fetch beim Dekodieren
  // automatisch — es ist ueber diesen Weg nicht pruefbar, deshalb hier ohne BOM verglichen.
  const zeilen = String(csv.body).trim().split('\r\n');
  assert.ok(zeilen[0].replace(/^\uFEFF/, '').startsWith('"EXTF";700;21;"Buchungsstapel"'), 'DATEV-Kopfzeile (EXTF, Format 700)');
  const buchungen = zeilen.slice(2);
  assert.equal(buchungen.length, 2, 'je Steuersatz eine Buchung');

  const b19 = buchungen.find((z) => z.split(';')[7] === '8400');
  const b7  = buchungen.find((z) => z.split(';')[7] === '8300');
  assert.ok(b19 && b7, 'Erloeskonten 8400 (19 %) und 8300 (7 %)');
  assert.equal(b19.split(';')[0], '119,00', 'Bruttobetrag mit Dezimalkomma');
  assert.equal(b19.split(';')[1], '"S"', 'Erloes im Soll auf dem Debitorenkonto');
  assert.equal(b19.split(';')[6], '1400', 'Debitorenkonto');
  assert.equal(b7.split(';')[0], '53,50');
  assert.ok(b19.includes('"' + r.rechnungsnr + '"'), 'Rechnungsnummer als Belegfeld 1');
});

test('DATEV-Export bucht das Storno gegen die Originalrechnung', async () => {
  const r = await festgeschriebeneRechnung();
  const s = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/storno');
  assert.equal(s.status, 201, JSON.stringify(s.body));

  const csv = await h.api(token, 'GET', '/api/rechnungen/export-datev?jahr=' + jahr);
  const buchungen = String(csv.body).trim().split('\r\n').slice(2);
  assert.equal(buchungen.length, 2, 'Original und Storno stehen beide im Stapel');
  const original = buchungen.find((z) => z.includes('"' + r.rechnungsnr + '"'));
  const storno   = buchungen.find((z) => z.includes('"' + s.body.rechnungsnr + '"'));
  assert.equal(original.split(';')[1], '"S"');
  assert.equal(storno.split(';')[1], '"H"', 'Storno bucht im Haben (Gegenbuchung)');
  assert.equal(original.split(';')[0], storno.split(';')[0], 'gleicher Betrag, umgekehrtes Vorzeichen');
});

test('Funktionstrennung: Mitarbeiter darf weder stornieren noch exportieren', async () => {
  const r = await festgeschriebeneRechnung();
  const ma = await h.seedNutzer('mitarbeiter');

  assert.equal((await h.api(ma.token, 'POST', '/api/rechnungen/' + r.id + '/storno')).status, 403);
  assert.equal((await h.api(ma.token, 'GET', '/api/rechnungen/export?jahr=' + jahr)).status, 403);
  assert.equal((await h.api(ma.token, 'GET', '/api/rechnungen/export-datev?jahr=' + jahr)).status, 403);

  // Das Tagesgeschaeft bleibt ihm erlaubt.
  assert.equal((await h.api(ma.token, 'GET', '/api/rechnungen')).status, 200);
});

test('Ohne gueltigen Token kommt niemand an Rechnungsdaten', async () => {
  assert.equal((await h.api(null, 'GET', '/api/rechnungen')).status, 401);
  assert.equal((await h.api('kaputt', 'GET', '/api/rechnungen')).status, 401);
});
