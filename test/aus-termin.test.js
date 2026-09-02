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

test('Online gebuchte Leistungen ergeben exakt den angezeigten Gesamtpreis', async () => {
  // Der Kunde hat bei der Buchung 44,00 + 14,00 + 49,00 + 10,00 = 117,00 EUR gesehen.
  // Genau dieser Betrag muss auf der Rechnung stehen — nicht 116,96 aus zurueckgerechneten
  // und wieder hochgerechneten Nettowerten.
  const { token } = await h.seedBasis({ preise_inkl_mwst: true });
  const kunde = await h.seedKunde();
  const leistungen = [
    { rolle: 'haupt',  bezeichnung: 'Raederwechsel',  mwst_satz: 19, grundpreis_netto: 36.97, zuschlag_netto: 0, zeilen_netto: 36.97, zeilen_brutto: 44 },
    { rolle: 'zusatz', bezeichnung: 'Raederwaesche',  mwst_satz: 19, grundpreis_netto: 11.76, zuschlag_netto: 0, zeilen_netto: 11.76, zeilen_brutto: 14 },
    { rolle: 'zusatz', bezeichnung: 'Einlagerung',    mwst_satz: 19, grundpreis_netto: 41.18, zuschlag_netto: 0, zeilen_netto: 41.18, zeilen_brutto: 49 },
    { rolle: 'zusatz', bezeichnung: 'Ventile',        mwst_satz: 19, grundpreis_netto: 8.40,  zuschlag_netto: 0, zeilen_netto: 8.40,  zeilen_brutto: 10 }
  ];
  const t = await h.query(
    `INSERT INTO termine (datum, uhrzeit_von, uhrzeit_bis, termin_typ, status, kunden_id, leistungen)
     VALUES (CURRENT_DATE, '09:00', '10:00', 'Raederwechsel', 'abgeschlossen', $1, $2) RETURNING id`,
    [kunde, JSON.stringify(leistungen)]);

  const r = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + t.rows[0].id);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(Number(r.body.brutto_summe), 117.00, 'exakt der online angezeigte Betrag');

  const pos = (await h.query('SELECT * FROM rechnung_positionen WHERE rechnung_id=$1 ORDER BY position', [r.body.id])).rows;
  assert.deepEqual(pos.map((p) => Number(p.zeilen_brutto)), [44, 14, 49, 10], 'jede Zeile behaelt ihren Betrag');
  assert.equal(Number(r.body.netto_summe) + Number(r.body.mwst_summe), 117.00);
});

test('Alte Buchungen ohne Bruttowert werden weiterhin uebernommen', async () => {
  const { token } = await h.seedBasis({ preise_inkl_mwst: true });
  const kunde = await h.seedKunde();
  const t = await h.query(
    `INSERT INTO termine (datum, uhrzeit_von, uhrzeit_bis, termin_typ, status, kunden_id, leistungen)
     VALUES (CURRENT_DATE, '09:00', '09:30', 'Alt', 'abgeschlossen', $1, $2) RETURNING id`,
    [kunde, JSON.stringify([{ bezeichnung: 'Altbestand', mwst_satz: 19, grundpreis_netto: 100, zuschlag_netto: 0 }])]);
  const r = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + t.rows[0].id);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(Number(r.body.netto_summe), 100);
  assert.equal(Number(r.body.brutto_summe), 119);
});

test('Gestaffelter Gutschein: jede Leistung behaelt ihren zugesagten Satz', async () => {
  // Nachgestellter Fall aus dem Portal: 25 % auf die Einlagerung, 10 % auf den Rest.
  // Ein einzelner Prozentsatz fuer den ganzen Beleg kann das nicht abbilden.
  const { token } = await h.seedBasis({ preise_inkl_mwst: true });
  const kunde = await h.seedKunde();
  const leistungen = [
    { bezeichnung: 'Reifeneinlagerung', mwst_satz: 19, zeilen_brutto: 40,   zeilen_netto: 33.61, grundpreis_netto: 33.61, zuschlag_netto: 0, rabatt_prozent: 25 },
    { bezeichnung: 'Auswuchten',        mwst_satz: 19, zeilen_brutto: 25,   zeilen_netto: 21.01, grundpreis_netto: 21.01, zuschlag_netto: 0, rabatt_prozent: 10 },
    { bezeichnung: 'Raederwaesche',     mwst_satz: 19, zeilen_brutto: 17.9, zeilen_netto: 15.04, grundpreis_netto: 15.04, zuschlag_netto: 0, rabatt_prozent: 10 }
  ];
  const t = await h.query(
    `INSERT INTO termine (datum, uhrzeit_von, uhrzeit_bis, termin_typ, status, kunden_id, leistungen, gutschein_code, gutschein_rabatt)
     VALUES (CURRENT_DATE, '09:00', '10:00', 'Raederwechsel', 'abgeschlossen', $1, $2, 'WINTER2026', 17) RETURNING id`,
    [kunde, JSON.stringify(leistungen)]);

  const r = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + t.rows[0].id);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // 82,90 abzueglich 25 % von 40,00 (= 10,00) und 10 % von 42,90 (= 4,29) ergibt 68,61.
  assert.equal(Number(r.body.brutto_summe), 68.61, 'gestaffelt gerechnet, nicht pauschal');

  const pos = (await h.query('SELECT bezeichnung, zeilen_brutto FROM rechnung_positionen WHERE rechnung_id=$1 ORDER BY position', [r.body.id])).rows;
  const nachlass = pos.filter((p) => /Nachlass/.test(p.bezeichnung));
  assert.equal(nachlass.length, 2, 'je Rabattsatz eine eigene Minusposition');
  assert.deepEqual(nachlass.map((p) => Number(p.zeilen_brutto)).sort((a, b) => a - b), [-10, -4.29]);
  assert.ok(nachlass.every((p) => p.bezeichnung.includes('WINTER2026')), 'der Code steht auf dem Beleg');
});

test('Kein zweiter Gutschein auf einen Termin, der schon einen Nachlass traegt', async () => {
  const { token } = await h.seedBasis({ preise_inkl_mwst: true });
  const kunde = await h.seedKunde();
  await h.query("INSERT INTO gutscheine (code, rabatt_prozent, aktiv) VALUES ('EXTRA10', 10, true)");
  const t = await h.query(
    `INSERT INTO termine (datum, uhrzeit_von, uhrzeit_bis, termin_typ, status, kunden_id, leistungen, gutschein_code)
     VALUES (CURRENT_DATE, '09:00', '09:30', 'Raederwechsel', 'abgeschlossen', $1, $2, 'WINTER2026') RETURNING id`,
    [kunde, JSON.stringify([{ bezeichnung: 'Einlagerung', mwst_satz: 19, zeilen_brutto: 40, rabatt_prozent: 25 }])]);

  const r = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + t.rows[0].id, { gutschein_code: 'EXTRA10' });
  assert.equal(r.status, 400, 'kein doppelter Nachlass');
  assert.match(r.body.error, /bereits ein Nachlass/);
});

test('Ohne Saetze je Leistung greift weiterhin der pauschale Satz vom Termin', async () => {
  const { token } = await h.seedBasis({ preise_inkl_mwst: true });
  const kunde = await h.seedKunde();
  const t = await h.query(
    `INSERT INTO termine (datum, uhrzeit_von, uhrzeit_bis, termin_typ, status, kunden_id, leistungen, gutschein_code, gutschein_rabatt)
     VALUES (CURRENT_DATE, '09:00', '09:30', 'Alt', 'abgeschlossen', $1, $2, 'ALT10', 10) RETURNING id`,
    [kunde, JSON.stringify([{ bezeichnung: 'Altbestand', mwst_satz: 19, zeilen_brutto: 100 }])]);
  const r = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + t.rows[0].id);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(Number(r.body.brutto_summe), 90.00, '10 % pauschal auf 100,00');
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
