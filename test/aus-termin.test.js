'use strict';
// "Rechnung aus Termin": der im Admin gepflegte Artikelpreis ist bei preise_inkl_mwst=true ein
// BRUTTO-Endpreis (so wird er auch auf der Preisseite beworben). Er muss auf der Rechnung exakt
// erhalten bleiben, die Steuer wird herausgerechnet — nicht umgekehrt aus einem gerundeten Netto
// wieder hochgerechnet (sonst wuerden aus 44,00 EUR entweder 43,99 EUR oder gar 52,36 EUR).
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');

test.before(async () => { await h.starteApp(); });
test.after(async () => { await h.stoppeApp(); });
test.beforeEach(async () => { await h.leereDaten(); });

async function terminMitArtikel(preis, mwst, kundenId) {
  const a = await h.query(
    "INSERT INTO artikel (name, preis, mwst_satz, einheit) VALUES ('Raederwechsel', $1, $2, 'Stk') RETURNING id",
    [preis, mwst]);
  const t = await h.query(
    `INSERT INTO termine (datum, uhrzeit_von, uhrzeit_bis, termin_typ, status, artikel_id, kunden_id, kennzeichen)
     VALUES (CURRENT_DATE, '09:00', '09:30', 'Raederwechsel', 'abgeschlossen', $1, $2, 'WOR-AB-1234') RETURNING id`,
    [a.rows[0].id, kundenId || null]);
  return t.rows[0].id;
}

test('Zugesagter Endpreis bleibt exakt, Steuer wird herausgerechnet (preise_inkl_mwst = true)', async () => {
  const { token } = await h.seedBasis({ preise_inkl_mwst: true });
  const kunde = await h.seedKunde();
  const terminId = await terminMitArtikel(44.00, 19, kunde);

  const r = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + terminId);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(Number(r.body.brutto_summe), 44.00, 'der zugesagte Endpreis bleibt exakt erhalten');
  assert.equal(Number(r.body.mwst_summe), 7.03, 'Steuer aus dem Brutto herausgerechnet (44,00 * 19 / 119)');
  assert.equal(Number(r.body.netto_summe), 36.97);
  assert.deepEqual(r.body.mwst_aufschluesselung, [{ satz: 19, netto: 36.97, mwst: 7.03 }]);

  const pos = (await h.query('SELECT * FROM rechnung_positionen WHERE rechnung_id=$1', [r.body.id])).rows;
  assert.equal(Number(pos[0].einzelpreis_netto), 36.97);
  assert.equal(Number(pos[0].zeilen_brutto), 44.00);
  assert.ok(pos[0].bezeichnung.includes('WOR-AB-1234'), 'Kennzeichen steht auf der Position');
});

test('Netto-Artikelpreis wird unveraendert uebernommen (preise_inkl_mwst = false)', async () => {
  const { token } = await h.seedBasis({ preise_inkl_mwst: false });
  const kunde = await h.seedKunde();
  const terminId = await terminMitArtikel(44.00, 19, kunde);

  const r = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + terminId);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(Number(r.body.netto_summe), 44.00);
  assert.equal(Number(r.body.brutto_summe), 52.36);
});

test('Fuer denselben Termin entsteht keine zweite Rechnung', async () => {
  const { token } = await h.seedBasis({ preise_inkl_mwst: true });
  const terminId = await terminMitArtikel(44.00, 19, await h.seedKunde());

  const erst = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + terminId);
  assert.equal(erst.status, 201);
  const zweit = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + terminId);
  assert.equal(zweit.status, 409, 'Doppelabrechnung wird verhindert');
});

test('Gast-Termin ohne Kundenkonto wird ueber den Kontaktdaten-Snapshot abgerechnet', async () => {
  const { token } = await h.seedBasis({ preise_inkl_mwst: true });
  const terminId = await terminMitArtikel(44.00, 19, null);
  await h.query("UPDATE termine SET kontakt_name='Erika Musterfrau' WHERE id=$1", [terminId]);

  const r = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + terminId);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.kunden_id, null, 'es wird kein Kundenkonto angelegt');
  assert.equal(r.body.empfaenger_name, 'Erika Musterfrau');
});

test('Termin ohne jeden Empfaengernamen wird abgelehnt statt still falsch abgerechnet', async () => {
  const { token } = await h.seedBasis({ preise_inkl_mwst: true });
  const terminId = await terminMitArtikel(44.00, 19, null);

  const r = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + terminId);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Empfänger/);
});
