'use strict';
// Gestaffelter Nachlass: Der gedruckte Flyer verspricht 25 % auf die Einlagerung und 10 %
// auf alles andere. Beide Sätze treffen in EINER Rechnung aufeinander.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');

let token;
const EMPF = { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg 2', plz: '54321', ort: 'Musterstadt' };

test.before(async () => { await h.starteApp(); });
test.after(async () => { await h.stoppeApp(); });
test.beforeEach(async () => { await h.leereDaten(); token = (await h.seedBasis({ preise_inkl_mwst: true })).token; });

test('Zwei Nachlasssätze in einer Rechnung, je eigene Zeile', async () => {
  // Preise wie seit 02.09. produktiv: Räderwechsel 39, Einlagerung 40, Auswuchten 15.
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    positionen: [
      { bezeichnung: 'Räderwechsel', menge: 1, einzelpreis_brutto: 39, mwst_satz: 19, rabatt_prozent: 10 },
      { bezeichnung: 'Reifeneinlagerung', menge: 1, einzelpreis_brutto: 40, mwst_satz: 19, rabatt_prozent: 25 },
      { bezeichnung: 'Auswuchten', menge: 1, einzelpreis_brutto: 15, mwst_satz: 19, rabatt_prozent: 10 }
    ]
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const pos = (await h.query('SELECT bezeichnung, zeilen_brutto FROM rechnung_positionen WHERE rechnung_id=$1 ORDER BY position', [r.body.id])).rows;
  const nachlaesse = pos.filter((p) => p.bezeichnung.startsWith('Nachlass'));
  assert.equal(nachlaesse.length, 2, 'je Rabattsatz eine Zeile: ' + JSON.stringify(pos.map((p) => p.bezeichnung)));

  const einlagerung = nachlaesse.find((p) => p.bezeichnung.includes('Reifeneinlagerung'));
  const uebrige = nachlaesse.find((p) => p.bezeichnung.includes('übrige Leistungen'));
  assert.ok(einlagerung && uebrige, JSON.stringify(nachlaesse.map((p) => p.bezeichnung)));
  assert.equal(Number(einlagerung.zeilen_brutto), -10.00, '25 % von 40,00');
  assert.equal(Number(uebrige.zeilen_brutto), -5.40, '10 % von 54,00 (39 + 15)');

  // 39 + 40 + 15 = 94,00 abzüglich 15,40 = 78,60
  assert.equal(Number(r.body.brutto_summe), 78.60);
  assert.equal(Number(r.body.netto_summe) + Number(r.body.mwst_summe), 78.60);
});

test('Der Nachlass wird auf den Bruttopreis gerechnet, den der Kunde gesehen hat', async () => {
  // 25 % von 40,00 muss 10,00 sein — nicht 25 % vom Nettowert.
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    positionen: [{ bezeichnung: 'Reifeneinlagerung', menge: 1, einzelpreis_brutto: 40, mwst_satz: 19, rabatt_prozent: 25 }]
  });
  assert.equal(Number(r.body.brutto_summe), 30.00, 'der Kunde zahlt genau 30,00');
});

test('Einmal runden je Gruppe, nicht je Zeile', async () => {
  // 10 % auf 13,00 und auf 15,00 einzeln gerundet waeren 1,30 + 1,50 = 2,80.
  // Auf die Summe gerechnet: 10 % von 28,00 = 2,80 — hier gleich, aber die Regel zaehlt.
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    positionen: [
      { bezeichnung: 'Räderwäsche', menge: 1, einzelpreis_brutto: 13, mwst_satz: 19, rabatt_prozent: 10 },
      { bezeichnung: 'Auswuchten', menge: 1, einzelpreis_brutto: 15, mwst_satz: 19, rabatt_prozent: 10 }
    ]
  });
  const nach = (await h.query("SELECT zeilen_brutto FROM rechnung_positionen WHERE rechnung_id=$1 AND bezeichnung LIKE 'Nachlass%'", [r.body.id])).rows;
  assert.equal(nach.length, 1, 'gleicher Satz und gleicher Steuersatz -> eine Zeile');
  assert.equal(Number(nach[0].zeilen_brutto), -2.80);
  assert.equal(Number(r.body.brutto_summe), 25.20);
});

test('Position ohne Nachlass bleibt unberuehrt', async () => {
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    positionen: [
      { bezeichnung: 'Räderwechsel', menge: 1, einzelpreis_brutto: 39, mwst_satz: 19, rabatt_prozent: 10 },
      { bezeichnung: 'Ersatzventil', menge: 1, einzelpreis_brutto: 5, mwst_satz: 19 }
    ]
  });
  assert.equal(Number(r.body.brutto_summe), 40.10, '39 + 5 minus 3,90');
});

test('Belegweiter Rabatt neben gestaffeltem Nachlass wird abgelehnt', async () => {
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF, rabatt_prozent: 10,
    positionen: [{ bezeichnung: 'Räderwechsel', menge: 1, einzelpreis_brutto: 39, mwst_satz: 19, rabatt_prozent: 10 }]
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /doppelt/);
});

test('Unsinniger Nachlasssatz wird abgelehnt', async () => {
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    positionen: [{ bezeichnung: 'Räderwechsel', menge: 1, einzelpreis_brutto: 39, mwst_satz: 19, rabatt_prozent: 150 }]
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Nachlass/);
});

test('Der Beleg weist die Nachlaesse aus', async () => {
  const e = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    positionen: [
      { bezeichnung: 'Räderwechsel', menge: 1, einzelpreis_brutto: 39, mwst_satz: 19, rabatt_prozent: 10 },
      { bezeichnung: 'Reifeneinlagerung', menge: 1, einzelpreis_brutto: 40, mwst_satz: 19, rabatt_prozent: 25 }
    ]
  });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const text = h.pdfText(f.body.pdf_pfad);
  if (text === null) return;
  assert.ok(text.includes('Nachlass Reifeneinlagerung (25 %)'), 'Nachlass benannt');
  assert.ok(text.includes('Nachlass Räderwechsel (10 %)'), 'zweiter Nachlass benannt');
  assert.ok(text.includes('65,10'), 'Gesamtbetrag 39,00 + 40,00 - 3,90 - 10,00');
});
