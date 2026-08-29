'use strict';
// GiroCode (EPC069-12) auf der Rechnung: Der QR-Code muss von Banking-Apps lesbar sein.
// Geprueft wird der Inhalt nach der EPC-Spezifikation und dass der Code im PDF landet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const h = require('./helper');
const { epcPayload } = require('../src/lib/rechnung-pdf');

const BANK = { firmenname: 'Schröder & Scholz', iban: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001' };

test('GiroCode-Inhalt entspricht der EPC069-12-Struktur', () => {
  const p = epcPayload(BANK, { brutto_summe: 44, rechnungsnr: 'RE-2026-0001' });
  const z = p.split('\n');
  // EPC069-12 kennt zwölf Felder; leere Felder am Ende dürfen entfallen. Hier endet der
  // Datensatz mit dem unstrukturierten Verwendungszweck (Feld 11).
  assert.equal(z.length, 11);
  assert.equal(z[0], 'BCD');
  assert.equal(z[1], '002', 'Version 2');
  assert.equal(z[2], '1', 'Zeichensatz UTF-8');
  assert.equal(z[3], 'SCT', 'SEPA-Überweisung');
  assert.equal(z[4], 'BYLADEM1001');
  assert.equal(z[5], 'Schröder & Scholz');
  assert.equal(z[6], 'DE021203000000002020 51'.replace(' ', ''), 'IBAN ohne Leerzeichen');
  assert.equal(z[7], 'EUR44.00', 'Betrag mit Punkt als Dezimaltrenner');
  assert.equal(z[8], '', 'Feld 9 (Purpose) bleibt leer');
  assert.equal(z[9], '', 'Feld 10 (strukturierte Referenz) bleibt leer — sonst dürfte Feld 11 nicht belegt sein');
  assert.equal(z[10], 'Rechnung RE-2026-0001', 'Feld 11: unstrukturierter Verwendungszweck');
  assert.ok(z[5].length <= 70 && z[10].length <= 140, 'Längengrenzen der Spezifikation');
});

test('Ohne IBAN und bei Betrag null entsteht kein GiroCode', () => {
  assert.equal(epcPayload({ firmenname: 'X' }, { brutto_summe: 44 }), null, 'ohne IBAN kein Code');
  assert.equal(epcPayload(BANK, { brutto_summe: 0 }), null, 'ohne Betrag kein Code');
  assert.equal(epcPayload(BANK, { brutto_summe: -119 }), null, 'kein Zahlcode auf einer Gutschrift');
});

test('Der GiroCode ist im erzeugten PDF tatsaechlich enthalten', async () => {
  await h.starteApp();
  await h.leereDaten();
  const b = await h.seedBasis();
  await h.query("UPDATE einstellungen SET bank='Sparkasse (Testdaten)', iban='DE02120300000000202051', bic='BYLADEM1001'");
  const e = await h.api(b.token, 'POST', '/api/rechnungen', {
    empfaenger: { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg 2', plz: '54321', ort: 'Musterstadt' },
    positionen: [{ bezeichnung: 'Raederwechsel', menge: 1, einzelpreis_brutto: 44, mwst_satz: 19 }]
  });
  const f = await h.api(b.token, 'POST', '/api/rechnungen/' + e.body.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));

  let bilder;
  try { bilder = execFileSync('pdfimages', ['-list', f.body.pdf_pfad]).toString(); }
  catch (x) { console.log('Hinweis: pdfimages nicht vorhanden - PDF-Bild nicht geprueft.'); await h.stoppeApp(); return; }
  assert.ok(bilder.trim().split('\n').length > 1, 'das PDF enthält ein Bild (den QR-Code)');

  const text = h.pdfText(f.body.pdf_pfad);
  if (text) {
    assert.ok(text.includes('DE02120300000000202051'), 'IBAN steht auch als Text auf der Rechnung');
    assert.ok(text.includes('GiroCode'), 'Hinweis zum Scannen vorhanden');
  }

  // Den QR-Code aus dem gerenderten PDF wirklich zurueckdecodieren. Ohne -Sbinary deutet
  // zbarimg den Byte-Modus als Shift-JIS und macht aus "Schröder" ein "Schr..." — das waere
  // ein Fehlalarm des Decoders, nicht ein Fehler im Code.
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'girocode-'));
  try {
    execFileSync('pdftoppm', ['-r', '300', '-png', '-singlefile', f.body.pdf_pfad, path.join(tmp, 'seite')]);
    const roh = execFileSync('zbarimg', ['--raw', '-q', '-Sbinary', path.join(tmp, 'seite.png')]);
    const gelesen = roh.toString('utf8').replace(/\n$/, '');
    const erwartet = epcPayload(
      { firmenname: 'Testbetrieb Rechnungswesen', iban: 'DE02120300000000202051', bic: 'BYLADEM1001' },
      { brutto_summe: 44, rechnungsnr: f.body.rechnungsnr });
    assert.equal(gelesen, erwartet, 'aus dem PDF gelesener GiroCode stimmt Byte fuer Byte mit dem Datensatz ueberein');
  } catch (x) {
    if (x.code === 'ENOENT') { console.log('Hinweis: zbarimg nicht vorhanden - QR nicht zurueckgelesen.'); }
    else { throw x; }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    await h.stoppeApp();
  }
});
