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

// ── Gestaffelter Gutschein am Tresen ─────────────────────────────────────────────────────────
// Der Flyer verspricht 25 % auf die Einlagerung und 10 % auf alles Uebrige. Frueher las das
// Rechnungswesen NUR gutscheine.rabatt_prozent und zog den Satz pauschal auf den ganzen Beleg —
// je nachdem, welcher Satz dort stand, war das zu viel oder zu wenig. Der Kunde bekam entweder
// 25 % auf Leistungen, fuer die sie nie versprochen waren, oder 10 % auf die Einlagerung,
// obwohl ihm 25 % zugesagt wurden.
async function seedGestaffelt() {
  const a = await h.query("INSERT INTO artikel (name, preis) VALUES ('Reifeneinlagerung', 40) RETURNING id");
  const b = await h.query("INSERT INTO artikel (name, preis) VALUES ('Auswuchten', 25) RETURNING id");
  const g = await h.query("INSERT INTO gutscheine (code, rabatt_prozent, aktiv) VALUES ('STAFFEL', 10, true) RETURNING id");
  await h.query('INSERT INTO gutschein_regeln (gutschein_id, artikel_id, rabatt_prozent) VALUES ($1,$2,25)',
    [g.rows[0].id, a.rows[0].id]);
  return { einlagerung: a.rows[0].id, auswuchten: b.rows[0].id };
}

test('Gutschein am Tresen wird je Leistung angewandt, nicht pauschal', async () => {
  const ids = await seedGestaffelt();
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    gutschein_code: 'STAFFEL',
    positionen: [
      { bezeichnung: 'Reifeneinlagerung', menge: 1, einzelpreis_brutto: 40, mwst_satz: 19, artikel_id: ids.einlagerung },
      { bezeichnung: 'Auswuchten', menge: 1, einzelpreis_brutto: 25, mwst_satz: 19, artikel_id: ids.auswuchten }
    ]
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const pos = (await h.query('SELECT bezeichnung, zeilen_brutto FROM rechnung_positionen WHERE rechnung_id=$1 ORDER BY position', [r.body.id])).rows;
  const minus = pos.filter((p) => Number(p.zeilen_brutto) < 0);
  assert.equal(minus.length, 2, 'je Satz eine eigene Zeile: ' + JSON.stringify(pos.map((p) => p.bezeichnung)));

  const betraege = minus.map((p) => Number(p.zeilen_brutto)).sort((x, y) => x - y);
  assert.deepEqual(betraege, [-10.00, -2.50], '25 % von 40,00 und 10 % von 25,00');
  assert.ok(minus.every((p) => p.bezeichnung.includes('STAFFEL')), 'der Code steht auf dem Beleg');

  // 65,00 abzueglich 12,50 = 52,50 — nicht 58,50 (pauschal 10 %) und nicht 48,75 (pauschal 25 %).
  assert.equal(Number(r.body.brutto_summe), 52.50);
});

test('Ohne passende Leistung sagt der Gutschein das, statt still nichts zu tun', async () => {
  await seedGestaffelt();
  await h.query("UPDATE gutscheine SET rabatt_prozent=0 WHERE code='STAFFEL'");
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    gutschein_code: 'STAFFEL',
    positionen: [{ bezeichnung: 'Sonderleistung', menge: 1, einzelpreis_brutto: 30, mwst_satz: 19 }]
  });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /keinen Nachlass/);
});

test('Gutschein neben bereits gesetzten Nachlaessen wird abgelehnt', async () => {
  await seedGestaffelt();
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    gutschein_code: 'STAFFEL',
    positionen: [{ bezeichnung: 'Auswuchten', menge: 1, einzelpreis_brutto: 25, mwst_satz: 19, rabatt_prozent: 10 }]
  });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /doppelt/);
});
