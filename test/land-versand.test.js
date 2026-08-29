'use strict';
// Ländercode des Empfängers und Rechnungsadresse beim Versand.
// Der Ländercode gehört als Snapshot an die Rechnung: eine ausgestellte Rechnung darf sich
// nicht rückwirkend ändern, wenn der Kunde später umzieht.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');

let token;

test.before(async () => { await h.starteApp(); });
test.after(async () => { await h.stoppeApp(); });
test.beforeEach(async () => {
  await h.leereDaten();
  token = (await h.seedBasis({ ust_id: 'DE123456789' })).token;
});

const POS = [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }];

test('Land wird aus dem Kundenstamm uebernommen und friert mit der Rechnung ein', async () => {
  const kunde = await h.seedKunde({ land: 'AT' });
  const e = await h.api(token, 'POST', '/api/rechnungen', { kunden_id: kunde, positionen: POS });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal(e.body.empfaenger_land, 'AT');

  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));

  // Der Kunde zieht um — die bereits ausgestellte Rechnung bleibt unveraendert.
  await h.query("UPDATE kunden SET land='CH' WHERE id=$1", [kunde]);
  const nach = (await h.api(token, 'GET', '/api/rechnungen/' + e.body.id)).body;
  assert.equal(nach.empfaenger_land, 'AT', 'Snapshot wandert nicht mit');
});

test('E-Rechnung traegt das Land des Empfaengers', async () => {
  const kunde = await h.seedKunde({ land: 'AT' });
  const e = await h.api(token, 'POST', '/api/rechnungen', { kunden_id: kunde, positionen: POS });
  await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  const xml = String((await h.api(token, 'GET', '/api/rechnungen/' + e.body.id + '/xrechnung')).body);

  const laender = xml.match(/<cbc:IdentificationCode>([A-Z]{2})<\/cbc:IdentificationCode>/g) || [];
  assert.equal(laender.length, 2, 'Aussteller und Empfaenger');
  assert.ok(xml.includes('<cbc:IdentificationCode>AT</cbc:IdentificationCode>'), 'Empfaengerland');
  assert.ok(xml.includes('<cbc:IdentificationCode>DE</cbc:IdentificationCode>'), 'Aussteller bleibt DE');
});

test('Ohne erfasstes Land gilt Deutschland', async () => {
  // Bestandskunden haben kein Land — die E-Rechnung darf deswegen nicht ohne Land bleiben.
  const kunde = await h.seedKunde();
  const e = await h.api(token, 'POST', '/api/rechnungen', { kunden_id: kunde, positionen: POS });
  assert.equal(e.body.empfaenger_land, null, 'nicht erfasst bleibt nicht erfasst');
  await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  const xml = String((await h.api(token, 'GET', '/api/rechnungen/' + e.body.id + '/xrechnung')).body);
  assert.equal((xml.match(/<cbc:IdentificationCode>DE<\/cbc:IdentificationCode>/g) || []).length, 2);
});

test('Manuell erfasstes Land wird uebernommen, Storno erbt es', async () => {
  const e = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: { vorname: 'Max', nachname: 'Mustermann', strasse: 'Weg 1', plz: '1010', ort: 'Wien', land: 'at' },
    positionen: POS
  });
  assert.equal(e.body.empfaenger_land, 'at');
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben')).status, 200);

  const s = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/storno');
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.empfaenger_land, 'at', 'der Korrekturbeleg gehoert zum selben Empfaenger');

  const xml = String((await h.api(token, 'GET', '/api/rechnungen/' + s.body.id + '/xrechnung')).body);
  assert.ok(xml.includes('<cbc:IdentificationCode>AT</cbc:IdentificationCode>'), 'Kleinschreibung wird normalisiert');
});

test('Versand nutzt die Rechnungsadresse, wenn eine hinterlegt ist', async () => {
  // Ohne SMTP schlaegt der Versand fehl (502). Entscheidend ist hier, dass die Route eine
  // Adresse FINDET — ein 400 waere der Beleg, dass rechnung_email uebersehen wurde.
  const kunde = await h.seedKunde({ email: null, rechnung_email: 'buchhaltung@qatest.example' });
  const e = await h.api(token, 'POST', '/api/rechnungen', { kunden_id: kunde, positionen: POS });
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben')).status, 200);

  const v = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/senden');
  assert.notEqual(v.status, 400, 'Rechnungsadresse wurde gefunden: ' + JSON.stringify(v.body));

  // Gegenprobe: gar keine Adresse -> klare Meldung statt Versandversuch.
  const ohne = await h.seedKunde({ email: null, kunden_nr: 'T-9999' });
  const e2 = await h.api(token, 'POST', '/api/rechnungen', { kunden_id: ohne, positionen: POS });
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + e2.body.id + '/festschreiben')).status, 200);
  const v2 = await h.api(token, 'POST', '/api/rechnungen/' + e2.body.id + '/senden');
  assert.equal(v2.status, 400);
  assert.match(v2.body.error, /E-Mail/);
});
