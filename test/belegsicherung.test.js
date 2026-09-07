'use strict';
// Belegsicherung: Der Schutztrigger sichert den Datensatz und den Dateipfad, nicht den INHALT
// der Belegdatei. Die GoBD halten eine blosse Ablage im Dateisystem ausdruecklich fuer nicht
// ausreichend (Rz. 110); tatsaechlich aufbewahrte elektronische Dokumente muessen ueber die
// gesamte Frist unveraenderbar bleiben (Rz. 119/120). Abgesichert wird das hier durch eine
// Pruefsumme je Datei und eine Kette ueber alle Belege.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const h = require('./helper');

let token;
const EMPF = { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg 2', plz: '54321', ort: 'Musterstadt' };

test.before(async () => { await h.starteApp(); });
test.after(async () => { await h.stoppeApp(); });
test.beforeEach(async () => { await h.leereDaten(); token = (await h.seedBasis()).token; });

async function festgeschriebeneRechnung(betrag) {
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: EMPF,
    positionen: [{ bezeichnung: 'Auswuchten', menge: 1, einzelpreis_netto: betrag || 100, mwst_satz: 19 }]
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const f = await h.api(token, 'POST', '/api/rechnungen/' + r.body.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  return f.body;
}

test('Festschreiben haelt die Pruefsumme der Belegdatei fest', async () => {
  const r = await festgeschriebeneRechnung();
  const db = (await h.query('SELECT pdf_pfad, pdf_sha256, beleg_hash, beleg_hash_vorgaenger FROM rechnungen WHERE id=$1', [r.id])).rows[0];

  assert.ok(db.pdf_sha256, 'Pruefsumme wurde gespeichert');
  assert.match(db.pdf_sha256, /^[0-9a-f]{64}$/, 'SHA-256 in Hexform');

  const crypto = require('crypto');
  const ist = crypto.createHash('sha256').update(fs.readFileSync(db.pdf_pfad)).digest('hex');
  assert.equal(ist, db.pdf_sha256, 'Pruefsumme gehoert zur tatsaechlich erzeugten Datei');

  assert.ok(db.beleg_hash, 'Kettenglied wurde gebildet');
  assert.equal(db.beleg_hash_vorgaenger, '', 'der erste Beleg haengt an keinem Vorgaenger');
});

test('Die Belegkette verbindet die Belege in ihrer Reihenfolge', async () => {
  const a = await festgeschriebeneRechnung(100);
  const b = await festgeschriebeneRechnung(200);

  const rows = (await h.query('SELECT rechnungsnr, beleg_hash, beleg_hash_vorgaenger FROM rechnungen ORDER BY rechnungsnr')).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rechnungsnr < rows[1].rechnungsnr, true);
  assert.equal(rows[1].beleg_hash_vorgaenger, rows[0].beleg_hash, 'der zweite Beleg verweist auf den ersten');
  assert.notEqual(rows[0].beleg_hash, rows[1].beleg_hash, 'jeder Beleg hat ein eigenes Glied');
  assert.ok(a.id && b.id);
});

test('Die Pruefsumme ist nachtraeglich nicht aenderbar', async () => {
  const r = await festgeschriebeneRechnung();
  await assert.rejects(
    () => h.query("UPDATE rechnungen SET pdf_sha256='00' WHERE id=$1", [r.id]),
    /Prüfsumme/, 'DB-Trigger muss die Aenderung der Pruefsumme blockieren');
  await assert.rejects(
    () => h.query("UPDATE rechnungen SET beleg_hash='00' WHERE id=$1", [r.id]),
    /Kettenglied/, 'DB-Trigger muss die Aenderung des Kettenglieds blockieren');
});

test('Ein veraenderter Beleg wird weder angezeigt noch versendet', async () => {
  const r = await festgeschriebeneRechnung();
  const pfad = (await h.query('SELECT pdf_pfad FROM rechnungen WHERE id=$1', [r.id])).rows[0].pdf_pfad;

  // Genau der Angriff, gegen den es geht: Datei auf der Platte austauschen, Datensatz unberuehrt.
  fs.writeFileSync(pfad, Buffer.concat([fs.readFileSync(pfad), Buffer.from('\nmanipuliert')]));

  const pdf = await h.api(token, 'GET', '/api/rechnungen/' + r.id + '/pdf');
  assert.equal(pdf.status, 409, 'Anzeige muss verweigert werden');

  const senden = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/senden', { email: 'kunde@intern.local' });
  assert.equal(senden.status, 409, 'Versand muss verweigert werden');

  // Der Vorfall darf nicht stillschweigend passieren.
  const log = await h.query("SELECT count(*)::int AS n FROM audit_log WHERE aktion='rechnung.beleg_abweichung'");
  assert.ok(log.rows[0].n >= 1, 'Abweichung wurde protokolliert');
});

test('Die Belegpruefung meldet heile Belege und findet den veraenderten', async () => {
  await festgeschriebeneRechnung(100);
  const zweite = await festgeschriebeneRechnung(200);

  const heil = await h.api(token, 'GET', '/api/rechnungen/belegpruefung');
  assert.equal(heil.status, 200, JSON.stringify(heil.body));
  assert.equal(heil.body.geprueft, 2);
  assert.equal(heil.body.in_ordnung, true, JSON.stringify(heil.body.befunde));
  assert.equal(heil.body.befunde.length, 0);

  const pfad = (await h.query('SELECT pdf_pfad FROM rechnungen WHERE id=$1', [zweite.id])).rows[0].pdf_pfad;
  fs.writeFileSync(pfad, 'kein gueltiges PDF mehr');

  const kaputt = await h.api(token, 'GET', '/api/rechnungen/belegpruefung');
  assert.equal(kaputt.body.in_ordnung, false);
  assert.equal(kaputt.body.befunde.length, 1, JSON.stringify(kaputt.body.befunde));
  assert.equal(kaputt.body.befunde[0].rechnungsnr, zweite.rechnungsnr);
  assert.equal(kaputt.body.befunde[0].art, 'datei');
});

test('Auch eine fehlende Belegdatei faellt auf', async () => {
  const r = await festgeschriebeneRechnung();
  const pfad = (await h.query('SELECT pdf_pfad FROM rechnungen WHERE id=$1', [r.id])).rows[0].pdf_pfad;
  fs.unlinkSync(pfad);

  const pr = await h.api(token, 'GET', '/api/rechnungen/belegpruefung');
  assert.equal(pr.body.in_ordnung, false);
  assert.match(pr.body.befunde[0].grund, /fehlt/i);
});

test('Der Storno haengt sich als eigenes Glied an die Kette', async () => {
  const r = await festgeschriebeneRechnung();
  const st = await h.api(token, 'POST', '/api/rechnungen/' + r.id + '/storno');
  assert.equal(st.status, 201, JSON.stringify(st.body));

  const rows = (await h.query('SELECT rechnungsnr, beleg_hash, beleg_hash_vorgaenger, pdf_sha256 FROM rechnungen ORDER BY rechnungsnr')).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows[1].pdf_sha256, 'auch der Storno-Beleg bekommt eine Pruefsumme');
  assert.equal(rows[1].beleg_hash_vorgaenger, rows[0].beleg_hash, 'der Storno haengt an der Originalrechnung');

  const pr = await h.api(token, 'GET', '/api/rechnungen/belegpruefung');
  assert.equal(pr.body.in_ordnung, true, JSON.stringify(pr.body.befunde));
  assert.equal(pr.body.geprueft, 2);
});

test('Auch bei gleichzeitigem Festschreiben bleibt die Kette geschlossen', async () => {
  // Die Kette entsteht in derselben kritischen Sektion wie die Nummernvergabe. Waere die
  // Sperre erst nach der Nummer genommen, koennten sich zwei Belege in falscher Reihenfolge
  // verketten — die Pruefung meldete dann einen Bruch, obwohl niemand etwas manipuliert hat.
  // Ein falscher Manipulationsalarm ist teurer als gar keiner: Er entwertet die Funktion.
  const anzahl = 8;
  const ids = [];
  for (let i = 0; i < anzahl; i++) {
    const r = await h.api(token, 'POST', '/api/rechnungen', {
      empfaenger: EMPF,
      positionen: [{ bezeichnung: 'Auswuchten', menge: 1, einzelpreis_netto: 10 + i, mwst_satz: 19 }]
    });
    assert.equal(r.status, 201);
    ids.push(r.body.id);
  }

  const res = await Promise.all(ids.map((id) => h.api(token, 'POST', '/api/rechnungen/' + id + '/festschreiben')));
  res.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r.body)));

  const rows = (await h.query('SELECT rechnungsnr, beleg_hash, beleg_hash_vorgaenger FROM rechnungen ORDER BY rechnungsnr')).rows;
  assert.equal(rows.length, anzahl);
  assert.equal(rows[0].beleg_hash_vorgaenger, '', 'der erste Beleg haengt an keinem Vorgaenger');
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i].beleg_hash_vorgaenger, rows[i - 1].beleg_hash,
      'Beleg ' + rows[i].rechnungsnr + ' muss auf ' + rows[i - 1].rechnungsnr + ' verweisen');
  }
  assert.equal(new Set(rows.map((r) => r.beleg_hash)).size, anzahl, 'jedes Kettenglied ist eindeutig');

  const pr = await h.api(token, 'GET', '/api/rechnungen/belegpruefung');
  assert.equal(pr.body.in_ordnung, true, JSON.stringify(pr.body.befunde));
  assert.equal(pr.body.geprueft, anzahl);
});

test('Nur der Inhaber darf die Belegpruefung ausloesen', async () => {
  const mitarbeiter = await h.seedNutzer('mitarbeiter');
  const pr = await h.api(mitarbeiter.token, 'GET', '/api/rechnungen/belegpruefung');
  assert.equal(pr.status, 403, 'Mitarbeiter darf nicht: ' + JSON.stringify(pr.body));
});
