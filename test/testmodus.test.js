'use strict';
// Testmodus: oeffnet den TSE-Riegel fuer einen Probelauf.
//
// Der gefaehrlichste Fehler hier ist nicht, dass er nicht funktioniert — sondern dass er
// eingeschaltet bleibt und niemand es merkt. Deshalb pruefen diese Tests vor allem, dass man
// ihm ansieht, dass er an war: in der Auskunft, auf dem Beleg und im eingefrorenen Abbild.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');

let token;
const EMPF = { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg 2', plz: '54321', ort: 'Musterstadt' };
const POS = [{ bezeichnung: 'Auswuchten', menge: 1, einzelpreis_brutto: 25, mwst_satz: 19 }];

test.before(async () => { await h.starteApp(); });
test.after(async () => { await h.stoppeApp(); delete process.env.KASSE_TESTMODUS; });
test.beforeEach(async () => {
  await h.leereDaten();
  token = (await h.seedBasis({ preise_inkl_mwst: true })).token;
  delete process.env.KASSE_TESTMODUS;
});

async function festgeschrieben() {
  const e = await h.api(token, 'POST', '/api/rechnungen', { empfaenger: EMPF, positionen: POS });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  return f.body;
}

test('Ohne Testmodus traegt eine Rechnung KEINEN Uebungsvermerk', async () => {
  const r = await festgeschrieben();
  const db = (await h.query('SELECT aussteller FROM rechnungen WHERE id=$1', [r.id])).rows[0];
  assert.equal(db.aussteller.testmodus, undefined, 'im Normalbetrieb darf kein Vermerk entstehen');
  const text = h.pdfText(r.pdf_pfad);
  if (text !== null) assert.ok(!/ÜBUNGSBELEG/.test(text), 'kein Uebungsaufdruck im Normalbetrieb');
});

test('Im Testmodus traegt die Rechnung den Vermerk dauerhaft — im Abbild und auf dem Beleg', async () => {
  process.env.KASSE_TESTMODUS = '1';
  const r = await festgeschrieben();

  const db = (await h.query('SELECT aussteller FROM rechnungen WHERE id=$1', [r.id])).rows[0];
  assert.equal(db.aussteller.testmodus, true, 'Vermerk im eingefrorenen Abbild');

  const text = h.pdfText(r.pdf_pfad);
  if (text !== null) assert.match(text, /ÜBUNGSBELEG/, 'Aufdruck auf dem Beleg');

  // Der Vermerk ist unveraenderbar — der Schutztrigger sperrt das Aussteller-Abbild.
  await assert.rejects(
    () => h.query("UPDATE rechnungen SET aussteller = aussteller - 'testmodus' WHERE id=$1", [r.id]),
    /unveränderbar/i, 'der Vermerk darf nicht nachtraeglich entfernt werden');
});

test('Uebungsbelege sind spaeter exakt auffindbar', async () => {
  process.env.KASSE_TESTMODUS = '1';
  const a = await festgeschrieben();
  delete process.env.KASSE_TESTMODUS;
  const b = await festgeschrieben();

  const uebung = (await h.query("SELECT rechnungsnr FROM rechnungen WHERE aussteller->>'testmodus' = 'true' ORDER BY rechnungsnr")).rows;
  assert.equal(uebung.length, 1, 'genau die eine Uebungsrechnung');
  assert.equal(uebung[0].rechnungsnr, a.rechnungsnr);
  assert.notEqual(uebung[0].rechnungsnr, b.rechnungsnr, 'die echte Rechnung ist nicht dabei');
});

test('Die Auskunft sagt, ob der Schalter an oder aus ist', async () => {
  const aus = await h.api(token, 'GET', '/api/rechnungen/kassenstatus');
  assert.equal(aus.status, 200);
  assert.equal(aus.body.testmodus, false, 'aus, wenn die Variable nicht gesetzt ist');

  process.env.KASSE_TESTMODUS = '1';
  const an = await h.api(token, 'GET', '/api/rechnungen/kassenstatus');
  assert.equal(an.body.testmodus, true);
  assert.match(an.body.grund || '', /TESTMODUS/, 'und sagt es im Klartext');
});
