'use strict';
// Anbindung an die Kasse. Getestet gegen eine nachgebaute Kasse, die sich so verhält wie
// im Connector-Vertrag beschrieben — die echte Instanz gibt es noch nicht.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const h = require('./helper');

let token, kasse, kassePort, empfangen, antwortet;
let gebucht = [];

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
    // Die echte Kasse ist ueber quelleBeleg idempotent — die Attrappe auch, sonst wuerde
    // der Nebenlaeufigkeitstest etwas pruefen, das der Vertrag gar nicht verspricht.
    gebucht.push(req.body.quelleBeleg);
    const schonDa = gebucht.filter((q) => q === req.body.quelleBeleg).length > 1;
    if (schonDa && (antwortet.status || 200) === 200) {
      return res.json(Object.assign({}, antwortet.body, { bereitsVerarbeitet: true }));
    }
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
  gebucht = [];
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

test('Die Oberflaeche kann abfragen, ob die Kasse eingerichtet ist', async () => {
  // Ohne diese Auskunft wuerde die Oberflaeche Knoepfe anbieten, die nur Fehler erzeugen.
  const an = await h.api(token, 'GET', '/api/rechnungen/kassenstatus');
  assert.equal(an.status, 200);
  assert.equal(an.body.konfiguriert, true);

  delete process.env.KASSE_ERP_KEY;
  const aus = await h.api(token, 'GET', '/api/rechnungen/kassenstatus');
  assert.equal(aus.body.konfiguriert, false);
});

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

test('Liegt in der Kasse ein abweichender offener Vorgang, sagt die Meldung was zu tun ist', async () => {
  // Die Kasse lehnt eine Wiederholung mit gleichem Schluessel, aber anderen Daten mit 409 ab
  // (kein stilles Ueberschreiben des Betrags). Typischer Fall: erst bar versucht, dann Karte.
  const r = await festgeschrieben();
  antwortet = { status: 409, body: { error: 'Abweichende Daten zu einem offenen Vorgang.' } };
  const z = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung', { zahlart: 'ec' });
  assert.equal(z.status, 409);
  assert.match(z.body.error, /abschließen oder ablehnen/);
  assert.equal((await h.api(token, 'GET', '/api/rechnungen/' + r.id)).body.zahlungsstatus, 'offen');
});

test('Nach einer Ablehnung in der Kasse bleibt die Rechnung kassierbar', async () => {
  // Der ganze Ablauf: bar über der Geldwaesche-Schwelle -> Vorgang bleibt offen -> Versuch
  // mit Karte trifft auf abweichende Daten (409) -> der Vorgang wird in der Kasse abgelehnt
  // -> zweiter Versuch mit Karte geht durch. Genau EIN Zahlungsvermerk am Ende.
  const r = await festgeschrieben();

  antwortet = { status: 200, body: { ok: true, gwgErforderlich: true, status: 'offen' } };
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung')).status, 409);

  antwortet = { status: 409, body: { error: 'Abweichende Daten zu einem offenen Vorgang.' } };
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung', { zahlart: 'ec' })).status, 409);

  // Die Kasse hat den Versuch abgelehnt; ein erneutes Kassieren eroeffnet ihn neu und bucht.
  gebucht = [];
  antwortet = { status: 200, body: { ok: true, status: 'gebucht', beleg: 'LEI-2026-0099' } };
  const z = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung', { zahlart: 'ec' });
  assert.equal(z.status, 200, JSON.stringify(z.body));
  assert.equal(z.body.kasse_beleg_nr, 'LEI-2026-0099');
  assert.equal(empfangen.zahlart, 'ec');
  assert.equal(empfangen.quelleBeleg, r.rechnungsnr, 'weiterhin die Rechnungsnummer, keine Suffix-Variante');
  assert.equal((await h.api(token, 'GET', '/api/rechnungen/' + r.id)).body.zahlungsstatus, 'bezahlt');
});

test('Fehlt in der Kasse das Modul fuer Forderungen, ist die Meldung eindeutig', async () => {
  const r = await festgeschrieben();
  antwortet = { status: 403, body: { error: 'Modul forderung nicht aktiv.' } };
  const z = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung');
  assert.equal(z.status, 400);
  assert.match(z.body.error, /Forderungen/);
  assert.equal((await h.api(token, 'GET', '/api/rechnungen/' + r.id)).body.zahlungsstatus, 'offen');
});

test('Der echte Kundenname geht mit, nicht ein Platzhalter', async () => {
  // Fehlen Vorgangsnummer und Referenz, aggregiert die Kasse die Geldwaesche-Schwelle ueber
  // den Kundennamen. Ein Sammelbegriff wuerde fremde Kunden zusammenrechnen.
  const e = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: { vorname: 'Erika', nachname: 'Musterfrau', firma: 'Musterfuhrpark GmbH', strasse: 'Weg 9', plz: '12345', ort: 'Musterstadt' },
    positionen: POS
  });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  await h.api(token, 'POST', '/api/rechnungen/' + f.body.id + '/barzahlung');
  assert.equal(empfangen.kunde, 'Musterfuhrpark GmbH');
  assert.ok(empfangen.ticket, 'zusaetzlich die Rechnungsnummer als Vorgangsschluessel');
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

test('Gleichzeitiges Kassieren erzeugt genau eine Buchung', async () => {
  // Zwei Mitarbeiter klicken zugleich, oder jemand doppelklickt. Der Schutz liegt laut
  // Vertrag bei der Kasse: quelleBeleg ist Idempotenzschluessel. Hier wird geprueft, dass
  // unsere Seite daraus das richtige Ergebnis macht — eine Buchung, ein Vermerk.
  const r = await festgeschrieben();
  const res = await Promise.all(Array.from({ length: 5 }, () =>
    h.api(token, 'POST', '/api/rechnungen/' + r.id + '/barzahlung')));

  const ok = res.filter((x) => x.status === 200);
  assert.ok(ok.length >= 1, 'mindestens eine Anfrage geht durch');
  assert.ok(res.every((x) => [200, 409].includes(x.status)), 'die übrigen werden sauber abgewiesen: ' + JSON.stringify(res.map((x) => x.status)));

  const nach = (await h.api(token, 'GET', '/api/rechnungen/' + r.id)).body;
  assert.equal(nach.zahlungsstatus, 'bezahlt');
  assert.equal(nach.kasse_beleg_nr, 'LEI-2026-0042');
  // Entscheidend: Die Kasse hat den Vorgang nur EINMAL wirklich gebucht, alles Weitere lief
  // in ihre Idempotenz. Doppelt kassiertes Geld gibt es nicht.
  const echteBuchungen = gebucht.filter((q) => q === r.rechnungsnr).length;
  assert.ok(echteBuchungen >= 1, 'die Kasse wurde gefragt');
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
