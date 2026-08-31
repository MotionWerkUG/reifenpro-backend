'use strict';
// Härtung gegen missbräuchliche oder versehentliche Eingaben (Funde des adversarialen Tests).
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');

let token;

test.before(async () => { await h.starteApp(); });
test.after(async () => { await h.stoppeApp(); });
test.beforeEach(async () => {
  await h.leereDaten();
  token = (await h.seedBasis()).token;
});

const EMPF = { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg 2', plz: '54321', ort: 'Musterstadt' };
const POS_OK = { bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 };

async function anlegen(positionen) {
  return h.api(token, 'POST', '/api/rechnungen', { empfaenger: EMPF, positionen: positionen });
}

test('Gleichzeitige Abrechnung desselben Termins erzeugt genau eine Rechnung', async () => {
  const a = await h.query("INSERT INTO artikel (name, preis, mwst_satz, einheit) VALUES ('Raederwechsel', 44, 19, 'Stk') RETURNING id");
  const kunde = await h.seedKunde();
  const t = await h.query(
    `INSERT INTO termine (datum, uhrzeit_von, uhrzeit_bis, termin_typ, status, artikel_id, kunden_id)
     VALUES (CURRENT_DATE, '09:00', '09:30', 'Raederwechsel', 'abgeschlossen', $1, $2) RETURNING id`,
    [a.rows[0].id, kunde]);

  const res = await Promise.all(Array.from({ length: 8 }, () =>
    h.api(token, 'POST', '/api/rechnungen/aus-termin/' + t.rows[0].id)));

  const erstellt = res.filter((r) => r.status === 201);
  const abgelehnt = res.filter((r) => r.status === 409);
  assert.equal(erstellt.length, 1, 'nur eine Rechnung darf entstehen');
  assert.equal(abgelehnt.length, 7, 'alle weiteren Anfragen werden abgelehnt');
  assert.equal((await h.query('SELECT COUNT(*)::int AS n FROM rechnungen')).rows[0].n, 1);
});

test('Eine Geschaeftsbezeichnung wird nicht faelschlich als Handelsregister-Rechtsform gelesen', async () => {
  // "Fahrzeugtechnik" enthaelt "ug" — eine Teilstring-Pruefung wuerde die Inhaber-Pflicht aushebeln.
  await h.query("UPDATE einstellungen SET inhaber='', rechtsform='Reifenservice und Fahrzeugtechnik'");
  const e = await anlegen([POS_OK]);
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  assert.equal(f.status, 400);
  assert.match(f.body.error, /Inhaber/);
});

test('Position ohne Bezeichnung wird abgelehnt', async () => {
  const r = await anlegen([{ bezeichnung: '   ', menge: 1, einzelpreis_netto: 50, mwst_satz: 19 }]);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Bezeichnung/);
});

test('Auch eine bereits gespeicherte Position ohne Bezeichnung wird nicht festgeschrieben', async () => {
  const e = await anlegen([POS_OK]);
  await h.query("UPDATE rechnung_positionen SET bezeichnung='' WHERE rechnung_id=$1", [e.body.id]);
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  assert.equal(f.status, 400);
  assert.match(f.body.error, /Bezeichnung/);
});

test('Unsinnige Zahlen enden in einer Fehlermeldung, nicht in einem Serverfehler', async () => {
  for (const p of [
    { bezeichnung: 'X', menge: 'Infinity', einzelpreis_netto: 10, mwst_satz: 19 },
    { bezeichnung: 'X', menge: 1, einzelpreis_netto: 'NaN', mwst_satz: 19 },
    { bezeichnung: 'X', menge: 1e15, einzelpreis_netto: 1e15, mwst_satz: 19 },
    { bezeichnung: 'X', menge: 1, einzelpreis_netto: 10, mwst_satz: 5000 }
  ]) {
    const r = await anlegen([p]);
    assert.equal(r.status, 400, 'erwartet 400 fuer ' + JSON.stringify(p) + ', kam ' + r.status);
  }
});

test('Massen-Positionen werden begrenzt', async () => {
  const viele = Array.from({ length: 201 }, (x, i) => ({ bezeichnung: 'Pos ' + i, menge: 1, einzelpreis_netto: 1, mwst_satz: 19 }));
  const r = await anlegen(viele);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Positionen/);

  const gerade_noch = await anlegen(viele.slice(0, 200));
  assert.equal(gerade_noch.status, 201, '200 Positionen sind erlaubt');
});

test('Mahnung erst nach Faelligkeit und mit Mindestabstand', async () => {
  const kunde = await h.seedKunde();
  await h.query("UPDATE kunden SET email='mahn-test@intern.local' WHERE id=$1", [kunde]);

  // 1) Zahlungsziel 14 Tage -> die Rechnung ist noch nicht faellig.
  const offen = await h.api(token, 'POST', '/api/rechnungen', { kunden_id: kunde, positionen: [POS_OK] });
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + offen.body.id + '/festschreiben')).status, 200);
  const zuFrueh = await h.api(token, 'POST', '/api/rechnungen/' + offen.body.id + '/mahnung');
  assert.equal(zuFrueh.status, 400);
  assert.match(zuFrueh.body.error, /fällig/);

  // 2) Zweite Rechnung mit Zahlungsziel 0 -> heute faellig, aber gerade erst gemahnt.
  await h.query('UPDATE einstellungen SET zahlungsziel_tage=0');
  const faellig = await h.api(token, 'POST', '/api/rechnungen', { kunden_id: kunde, positionen: [POS_OK] });
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + faellig.body.id + '/festschreiben')).status, 200);
  // mahnstufe/mahnung_am duerfen sich aendern (der GoBD-Trigger sperrt nur den Rechnungsinhalt).
  await h.query('UPDATE rechnungen SET mahnung_am=CURRENT_DATE-2, mahnstufe=1 WHERE id=$1', [faellig.body.id]);
  const zuDicht = await h.api(token, 'POST', '/api/rechnungen/' + faellig.body.id + '/mahnung');
  assert.equal(zuDicht.status, 400);
  assert.match(zuDicht.body.error, /nächste Mahnung/);
});
