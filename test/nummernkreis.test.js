'use strict';
// Nummernkreis: fortlaufend, lueckenlos, keine Doppelvergabe, keine Rueckdatierung.
// Rechtlicher Hintergrund: § 14 Abs. 4 Nr. 4 UStG (einmalige, fortlaufende Nummer),
// GoBD (Vollstaendigkeit, Unveraenderbarkeit, keine Rueck-/Vordatierung).
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');

let token;
let jahr; // Jahr des Nummernkreises — kommt vom Server (Europe/Berlin), nicht von der lokalen Node-Zeit

test.before(async () => { await h.starteApp(); });
test.after(async () => { await h.stoppeApp(); });
test.beforeEach(async () => {
  await h.leereDaten();
  const b = await h.seedBasis();
  token = b.token;
  jahr = await h.serverJahr();
});

function entwurfKoerper(zusatz) {
  return Object.assign({
    empfaenger: { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg 2', plz: '54321', ort: 'Musterstadt' },
    positionen: [{ bezeichnung: 'Raederwechsel', menge: 1, einheit: 'Stk', einzelpreis_netto: 100, mwst_satz: 19 }]
  }, zusatz || {});
}

async function neuerEntwurf(zusatz) {
  const r = await h.api(token, 'POST', '/api/rechnungen', entwurfKoerper(zusatz));
  assert.equal(r.status, 201, 'Entwurf anlegen: ' + JSON.stringify(r.body));
  return r.body.id;
}

test('Nummern laufen lueckenlos und fortlaufend hoch', async () => {
  const nummern = [];
  for (let i = 0; i < 3; i++) {
    const id = await neuerEntwurf();
    const f = await h.api(token, 'POST', '/api/rechnungen/' + id + '/festschreiben');
    assert.equal(f.status, 200, JSON.stringify(f.body));
    nummern.push(f.body.rechnungsnr);
  }
  assert.deepEqual(nummern, ['RE-' + jahr + '-0001', 'RE-' + jahr + '-0002', 'RE-' + jahr + '-0003']);
});

test('Gleichzeitiges Festschreiben vergibt jede Nummer genau einmal', async () => {
  const anzahl = 8;
  const ids = [];
  for (let i = 0; i < anzahl; i++) ids.push(await neuerEntwurf());

  const res = await Promise.all(ids.map((id) => h.api(token, 'POST', '/api/rechnungen/' + id + '/festschreiben')));
  res.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r.body)));

  const nummern = res.map((r) => r.body.rechnungsnr).sort();
  const erwartet = [];
  for (let i = 1; i <= anzahl; i++) erwartet.push('RE-' + jahr + '-' + String(i).padStart(4, '0'));
  assert.deepEqual(nummern, erwartet, 'Nummern muessen 1..' + anzahl + ' ohne Luecke und ohne Doppel sein');
  assert.equal(new Set(nummern).size, anzahl, 'keine doppelte Rechnungsnummer');
});

test('Zweites Festschreiben derselben Rechnung wird abgelehnt und verbraucht keine Nummer', async () => {
  const id = await neuerEntwurf();
  const erst = await h.api(token, 'POST', '/api/rechnungen/' + id + '/festschreiben');
  assert.equal(erst.status, 200);
  const zweit = await h.api(token, 'POST', '/api/rechnungen/' + id + '/festschreiben');
  assert.equal(zweit.status, 400);

  const c = await h.query('SELECT letzte_nr FROM rechnung_counter WHERE jahr=$1', [jahr]);
  assert.equal(Number(c.rows[0].letzte_nr), 1, 'Zaehler darf durch den Fehlversuch nicht steigen');
});

test('Abgelehntes Festschreiben (Pflichtangabe fehlt) reisst keine Luecke in den Nummernkreis', async () => {
  // Erst eine gueltige Rechnung -> RE-JJJJ-0001
  const ok1 = await h.api(token, 'POST', '/api/rechnungen/' + (await neuerEntwurf()) + '/festschreiben');
  assert.equal(ok1.status, 200);

  // Dann ein Entwurf ohne Empfaenger (nur ueber die DB moeglich, die API verlangt ihn bereits)
  const leer = await h.query(
    `INSERT INTO rechnungen (status, netto_summe, mwst_summe, brutto_summe, rechnungsdatum, leistungsdatum)
     VALUES ('entwurf', 100, 19, 119, CURRENT_DATE, CURRENT_DATE) RETURNING id`);
  await h.query(
    `INSERT INTO rechnung_positionen (rechnung_id, position, bezeichnung, menge, einheit, einzelpreis_netto, mwst_satz, zeilen_netto, zeilen_brutto)
     VALUES ($1,1,'Test',1,'Stk',100,19,100,119)`, [leer.rows[0].id]);
  const fehler = await h.api(token, 'POST', '/api/rechnungen/' + leer.rows[0].id + '/festschreiben');
  assert.equal(fehler.status, 400);

  // Danach muss die naechste gueltige Rechnung die 0002 bekommen (keine verbrannte Nummer)
  const ok2 = await h.api(token, 'POST', '/api/rechnungen/' + (await neuerEntwurf()) + '/festschreiben');
  assert.equal(ok2.status, 200);
  assert.equal(ok2.body.rechnungsnr, 'RE-' + jahr + '-0002');
});

test('Rueckdatierung im Entwurf wird beim Festschreiben durch das Serverdatum ersetzt', async () => {
  const id = await neuerEntwurf({ rechnungsdatum: '2021-01-05', leistungsdatum: '2021-01-05' });
  const entwurf = await h.query('SELECT rechnungsdatum FROM rechnungen WHERE id=$1', [id]);
  assert.equal(entwurf.rows[0].rechnungsdatum, '2021-01-05', 'im Entwurf darf der Wunschwert stehen');

  const f = await h.api(token, 'POST', '/api/rechnungen/' + id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const heute = (await h.query("SELECT to_char((now() AT TIME ZONE 'Europe/Berlin')::date,'YYYY-MM-DD') AS d")).rows[0].d;
  assert.equal(f.body.rechnungsdatum, heute, 'Rechnungsdatum = Ausstellungsdatum (Serverzeit)');
  assert.equal(f.body.leistungsdatum, '2021-01-05', 'Leistungsdatum bleibt erhalten (§ 14 Abs. 4 Nr. 6 UStG)');
  assert.equal(f.body.rechnungsnr.slice(3, 7), String(jahr), 'Nummernkreis-Jahr folgt dem Ausstellungsdatum');
});

test('Vordatierung wird beim Anlegen abgelehnt', async () => {
  const uebermorgen = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const r = await h.api(token, 'POST', '/api/rechnungen', entwurfKoerper({ rechnungsdatum: uebermorgen }));
  assert.equal(r.status, 400);
});

test('Nummer und Datum bleiben monoton (spaetere Nummer nie aelteres Datum)', async () => {
  for (let i = 0; i < 3; i++) {
    const id = await neuerEntwurf({ rechnungsdatum: i === 1 ? '2020-03-03' : undefined });
    const f = await h.api(token, 'POST', '/api/rechnungen/' + id + '/festschreiben');
    assert.equal(f.status, 200);
  }
  const { rows } = await h.query(
    "SELECT rechnungsnr, to_char(rechnungsdatum,'YYYY-MM-DD') AS d FROM rechnungen WHERE status='festgeschrieben' ORDER BY rechnungsnr");
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].d >= rows[i - 1].d, 'Rechnung ' + rows[i].rechnungsnr + ' darf nicht aelter sein als ' + rows[i - 1].rechnungsnr);
  }
});

test('Jahreswechsel: der Nummernkreis beginnt im neuen Jahr wieder bei 0001', async () => {
  // Vorjahr mit bereits vergebenen Nummern simulieren — der Zaehler haengt am Jahr (PK).
  await h.query('INSERT INTO rechnung_counter (jahr, letzte_nr) VALUES ($1, 17)', [jahr - 1]);
  const f = await h.api(token, 'POST', '/api/rechnungen/' + (await neuerEntwurf()) + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(f.body.rechnungsnr, 'RE-' + jahr + '-0001', 'neues Jahr faengt bei 1 an');

  const vorjahr = await h.query('SELECT letzte_nr FROM rechnung_counter WHERE jahr=$1', [jahr - 1]);
  assert.equal(Number(vorjahr.rows[0].letzte_nr), 17, 'der Zaehler des Vorjahres bleibt unangetastet');
});

test('Verworfener Entwurf loest die Termin-Verknuepfung, statt am Fremdschluessel zu scheitern', async () => {
  const id = await neuerEntwurf();
  const t = await h.query(
    `INSERT INTO termine (datum, uhrzeit_von, uhrzeit_bis, termin_typ, status, rechnung_id)
     VALUES (CURRENT_DATE, '09:00', '09:30', 'Raederwechsel', 'abgeschlossen', $1) RETURNING id`, [id]);

  const del = await h.api(token, 'DELETE', '/api/rechnungen/' + id);
  assert.equal(del.status, 200, JSON.stringify(del.body));

  const nach = await h.query('SELECT rechnung_id FROM termine WHERE id=$1', [t.rows[0].id]);
  assert.equal(nach.rows[0].rechnung_id, null, 'Termin ist wieder abrechenbar');
  assert.equal((await h.query('SELECT 1 FROM rechnungen WHERE id=$1', [id])).rows.length, 0);
});

test('Storno bekommt eine eigene fortlaufende Nummer, das Original bleibt bestehen', async () => {
  const id = await neuerEntwurf();
  const f = await h.api(token, 'POST', '/api/rechnungen/' + id + '/festschreiben');
  assert.equal(f.status, 200);

  const s = await h.api(token, 'POST', '/api/rechnungen/' + id + '/storno');
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.rechnungsnr, 'RE-' + jahr + '-0002');
  assert.equal(s.body.storno_von_id, id);
  assert.equal(Number(s.body.brutto_summe), -Number(f.body.brutto_summe), 'Storno kehrt die Betraege um');
  assert.equal(s.body.leistungsdatum, f.body.leistungsdatum, 'Leistungszeitraum der Originalrechnung bleibt');

  const orig = await h.query('SELECT status FROM rechnungen WHERE id=$1', [id]);
  assert.equal(orig.rows[0].status, 'storniert', 'Original wird nicht geloescht, sondern als storniert markiert');

  const zweiterVersuch = await h.api(token, 'POST', '/api/rechnungen/' + id + '/storno');
  assert.equal(zweiterVersuch.status, 400, 'kein doppeltes Storno');

  // Der Beleg muss die Originalrechnung selbst benennen (eindeutige Zuordnung der Korrektur).
  // Braucht pdftotext (Paket poppler-utils); fehlt es, wird nur dieser Teil uebersprungen.
  const text = h.pdfText(s.body.pdf_pfad);
  if (text === null) { console.log('Hinweis: pdftotext nicht vorhanden - PDF-Inhalt nicht geprueft.'); return; }
  assert.ok(text.includes('Stornorechnung'), 'Beleg ist als Stornorechnung ausgewiesen');
  assert.ok(text.includes(f.body.rechnungsnr), 'Nummer der Originalrechnung steht auf dem Storno-Beleg');
});

test('Festgeschriebene Rechnung ist unveraenderbar und nicht loeschbar', async () => {
  const id = await neuerEntwurf();
  assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + id + '/festschreiben')).status, 200);

  assert.equal((await h.api(token, 'PUT', '/api/rechnungen/' + id, entwurfKoerper())).status, 400);
  assert.equal((await h.api(token, 'DELETE', '/api/rechnungen/' + id)).status, 400);

  // Und auch direkt auf der Datenbank (GoBD-Schutztrigger)
  await assert.rejects(
    () => h.query('UPDATE rechnungen SET brutto_summe=1 WHERE id=$1', [id]),
    /.*/, 'DB-Trigger muss die Aenderung blockieren');
  await assert.rejects(
    () => h.query('DELETE FROM rechnungen WHERE id=$1', [id]),
    /.*/, 'DB-Trigger muss das Loeschen blockieren');
});
