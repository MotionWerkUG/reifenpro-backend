'use strict';
// Anbindung an die Kasse. Getestet gegen eine nachgebaute Kasse, die sich so verhält wie
// im Connector-Vertrag beschrieben — die echte Instanz gibt es noch nicht.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const h = require('./helper');

let token, kasse, kassePort, empfangen, antwortet;

const EMPF = { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg 2', plz: '54321', ort: 'Musterstadt' };
const POS = [{ bezeichnung: 'Raederwechsel', menge: 1, einzelpreis_brutto: 119, mwst_satz: 19 }];

test.before(async () => {
  await h.starteApp();
  // Nachgebaute Kasse: merkt sich, was ankam, und antwortet nach Vorgabe des Tests.
  const app = express();
  app.use(express.json());
  app.post('/api/kassenvorgang', (req, res) => {
    if (req.get('X-ERP-Key') !== 'test-schluessel') return res.status(401).json({ error: 'Ungültiger X-ERP-Key' });
    empfangen = req.body;
    if (!req.body.quelleBeleg) return res.status(400).json({ error: 'quelleBeleg ist Pflicht.' });
    res.status(antwortet.status || 200).json(antwortet.body);
  });
  await new Promise((ok) => { kasse = app.listen(0, '127.0.0.1', ok); });
  kassePort = kasse.address().port;
});
test.after(async () => { await new Promise((ok) => kasse.close(ok)); await h.stoppeApp(); });

test.beforeEach(async () => {
  await h.leereDaten();
  token = (await h.seedBasis()).token;
  empfangen = null;
  antwortet = { status: 200, body: { ok: true, status: 'gebucht', beleg: 'LEI-2026-0042', belegUrl: 'https://kasse.example/bon/LEI-2026-0042/abc' } };
  process.env.KASSE_URL = 'http://127.0.0.1:' + kassePort;
  process.env.KASSE_ERP_KEY = 'test-schluessel';
});

async function festgeschrieben() {
  const e = await h.api(token, 'POST', '/api/rechnungen', { empfaenger: EMPF, positionen: POS });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  return f.body;
}

test('Barzahlung wird an die Kasse gemeldet und an der Rechnung vermerkt', async () => {
  const r = await festgeschrieben();
  const z = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung', { zahlart: 'bar' });
  assert.equal(z.status, 200, JSON.stringify(z.body));

  // Was die Kasse bekommen hat — der Vertrag in Feldern.
  assert.equal(empfangen.quelleBeleg, r.rechnungsnr, 'Rechnungsnummer als Idempotenz- und Zuordnungsschlüssel');
  assert.equal(empfangen.ticket, r.rechnungsnr);
  assert.equal(empfangen.betragArt, 'rechnungsausgleich', 'kein Erlös, sondern Forderungsausgleich');
  assert.equal(empfangen.zahlart, 'bar');
  assert.equal(Number(empfangen.betrag), 119);
  assert.equal(empfangen.sofortBuchen, true, 'unmittelbar buchen und signieren');

  // Was an der Rechnung steht.
  assert.equal(z.body.zahlungsstatus, 'bezahlt');
  assert.equal(z.body.kasse_beleg_nr, 'LEI-2026-0042');
  assert.ok(z.body.kasse_beleg_url.includes('LEI-2026-0042'));
  assert.ok(z.body.bezahlt_am, 'Zahlungsdatum gesetzt');
});

test('Antwortet die Kasse nicht, bleibt die Rechnung offen', async () => {
  const r = await festgeschrieben();
  process.env.KASSE_URL = 'http://127.0.0.1:1';   // niemand hört zu
  const z = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung');
  assert.equal(z.status, 502);
  assert.match(z.body.error, /nicht erreichbar/);

  const nach = (await h.api(token, 'GET', '/api/rechnungen/' + r.id)).body;
  assert.equal(nach.zahlungsstatus, 'offen', 'ohne Buchung in der Kasse kein Vermerk an der Rechnung');
  assert.equal(nach.kasse_beleg_nr, null);
});

test('Lehnt die Kasse ab, bleibt die Rechnung offen', async () => {
  const r = await festgeschrieben();
  antwortet = { status: 400, body: { error: 'Unbekannte Betragsart.' } };
  const z = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung');
  assert.equal(z.status, 400);
  assert.match(z.body.error, /abgelehnt/);
  assert.equal((await h.api(token, 'GET', '/api/rechnungen/' + r.id)).body.zahlungsstatus, 'offen');
});

test('Ueber der Geldwaesche-Schwelle gilt die Rechnung nicht als bezahlt', async () => {
  const r = await festgeschrieben();
  antwortet = { status: 200, body: { ok: true, gwgErforderlich: true, status: 'offen' } };
  const z = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung');
  assert.equal(z.status, 409);
  assert.match(z.body.error, /Identitätsnachweis/);
  assert.equal((await h.api(token, 'GET', '/api/rechnungen/' + r.id)).body.zahlungsstatus, 'offen');
});

test('Zweimal kassieren wird abgelehnt', async () => {
  const r = await festgeschrieben();
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung')).status, 200);
  const zweit = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung');
  assert.equal(zweit.status, 409);
});

test('Entwurf und Stornorechnung werden nicht kassiert', async () => {
  const e = await h.api(token, 'POST', '/api/rechnungen', { empfaenger: EMPF, positionen: POS });
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/barzahlung')).status, 400);

  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  const s = await h.api(token, 'POST', '/api/rechnungen/' + f.body.id + '/storno');
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + s.body.id + '/barzahlung')).status, 400);
});

test('Unbekannte Zahlart wird abgelehnt, bevor die Kasse etwas sieht', async () => {
  const r = await festgeschrieben();
  empfangen = null;
  const z = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung', { zahlart: 'krypto' });
  assert.equal(z.status, 400);
  assert.equal(empfangen, null, 'die Kasse wurde gar nicht erst gefragt');
});

test('Ohne eingerichtete Anbindung kommt eine klare Meldung', async () => {
  const r = await festgeschrieben();
  delete process.env.KASSE_ERP_KEY;
  const z = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung');
  assert.equal(z.status, 503);
  assert.match(z.body.error, /nicht eingerichtet/);
});

test('Der Kassenvermerk laesst sich an einer festgeschriebenen Rechnung setzen, der Inhalt nicht', async () => {
  const r = await festgeschrieben();
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung')).status, 200);
  // Gegenprobe: Der geschuetzte Inhalt bleibt gesperrt, auch das Empfaengerland.
  await assert.rejects(() => h.query("UPDATE rechnungen SET empfaenger_land='FR' WHERE id=$1", [r.id]), /.*/);
});
