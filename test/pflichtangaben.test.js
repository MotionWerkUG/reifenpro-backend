'use strict';
// § 14 UStG: Pflichtangaben und Rechenwerk. Geprueft wird, dass eine Rechnung ohne
// vollstaendige Pflichtangaben gar nicht erst festgeschrieben werden kann und dass
// Summen/MwSt serverseitig berechnet werden (Client-Werte zaehlen nicht).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const h = require('./helper');

test.before(async () => { await h.starteApp(); });
test.after(async () => { await h.stoppeApp(); });
test.beforeEach(async () => { await h.leereDaten(); });

const EMPF_VOLL = { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg 2', plz: '54321', ort: 'Musterstadt' };

async function entwurf(token, koerper) {
  const r = await h.api(token, 'POST', '/api/rechnungen', koerper);
  assert.equal(r.status, 201, 'Entwurf anlegen: ' + JSON.stringify(r.body));
  return r.body;
}

test('Ohne Steuernummer und ohne USt-IdNr. kann nicht festgeschrieben werden', async () => {
  const { token } = await h.seedBasis({ steuernummer: null, ust_id: null });
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 400);
  assert.match(f.body.error, /Steuernummer|USt-IdNr/);
});

test('UG in Gruendung: Geschaeftsfuehrer ist Pflicht und wird so benannt', async () => {
  // Vor der Eintragung benennt die Firma allein den Unternehmer nicht. Und eine
  // Kapitalgesellschaft hat keinen Inhaber, sondern einen Geschaeftsfuehrer.
  const { token } = await h.seedBasis();
  await h.query("UPDATE einstellungen SET rechtsform='UG (haftungsbeschränkt) i.G.', inhaber='', firmenname='Schröder & Scholz UG (haftungsbeschränkt) i.G.'");
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
  const ohne = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(ohne.status, 400);
  assert.match(ohne.body.error, /vertretungsberechtigten/);

  await h.query("UPDATE einstellungen SET inhaber='Marko Scholz'");
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const text = h.pdfText(f.body.pdf_pfad);
  if (text === null) return;
  assert.ok(text.includes('Geschäftsführer: Marko Scholz'), 'bei einer UG steht Geschäftsführer, nicht Inhaber');
  assert.ok(!text.includes('Inhaber: Marko Scholz'));
  assert.ok(!/HRB/.test(text), 'ohne Eintragung darf keine Registernummer auf dem Beleg stehen');
});

test('Einzelunternehmen behaelt die Beschriftung Inhaber', async () => {
  const { token } = await h.seedBasis();
  await h.query("UPDATE einstellungen SET rechtsform='Einzelunternehmen', inhaber='Max Beispiel'");
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200);
  const text = h.pdfText(f.body.pdf_pfad);
  if (text === null) return;
  assert.ok(text.includes('Inhaber: Max Beispiel'));
});

test('Eine formal ungueltige USt-IdNr. wird abgelehnt', async () => {
  // Ein Platzhalter wie DE123456 hat nur sechs Ziffern und waere auf jeder Rechnung eine
  // falsche Pflichtangabe. Besser gar keine Angabe als eine erfundene.
  const { token } = await h.seedBasis({ ust_id: 'DE123456' });
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 400);
  assert.match(f.body.error, /USt-IdNr/);
});

test('Eine gueltige USt-IdNr. wird akzeptiert, mit und ohne Leerzeichen', async () => {
  for (const nr of ['DE123456789', 'DE 123456789']) {
    await h.leereDaten();
    const { token } = await h.seedBasis({ ust_id: nr });
    const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
    assert.equal((await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben')).status, 200, 'abgelehnt: ' + nr);
  }
});

test('Allein die USt-IdNr. genuegt als Ausstellerkennung', async () => {
  const { token } = await h.seedBasis({ steuernummer: null, ust_id: 'DE123456789' });
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(f.body.aussteller.ust_id, 'DE123456789');
});

test('Ueber 250 EUR ist die vollstaendige Anschrift des Empfaengers Pflicht', async () => {
  const { token } = await h.seedBasis();
  const e = await entwurf(token, {
    empfaenger: { vorname: 'Max', nachname: 'Mustermann' },
    positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 300, mwst_satz: 19 }]
  });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 400);
  assert.match(f.body.error, /Anschrift/);
});

test('Kleinbetragsrechnung bis 250 EUR geht ohne Anschrift (§ 33 UStDV)', async () => {
  const { token } = await h.seedBasis();
  const e = await entwurf(token, {
    empfaenger: { vorname: 'Max', nachname: 'Mustermann' },
    positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }]
  });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
});

test('Rechnung ueber 0,00 EUR kann nicht festgeschrieben werden', async () => {
  const { token } = await h.seedBasis();
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Gratis', menge: 1, einzelpreis_netto: 0, mwst_satz: 19 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 400);
});

test('Ohne vollstaendige Aussteller-Anschrift kann nicht festgeschrieben werden', async () => {
  // § 14 Abs. 4 Nr. 1 UStG verlangt Name und Anschrift des Ausstellers unabhaengig vom Betrag.
  // Die Kleinbetragsregelung (§ 33 UStDV) lockert nur die Empfaengerangaben.
  const { token } = await h.seedBasis();
  await h.query("UPDATE einstellungen SET strasse='', plz='', ort=''");
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 400);
  assert.match(f.body.error, /Aussteller/);
});

test('Einzelunternehmen ohne Inhabernamen kann nicht festschreiben, eine GmbH schon', async () => {
  const { token } = await h.seedBasis();
  await h.query("UPDATE einstellungen SET inhaber='', rechtsform='Einzelunternehmen'");
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 400);
  assert.match(f.body.error, /Inhaber/);

  // Bei einer eingetragenen Rechtsform traegt die Firma selbst den Namen des Unternehmers.
  await h.query("UPDATE einstellungen SET rechtsform='GmbH'");
  const f2 = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f2.status, 200, JSON.stringify(f2.body));
});

test('Steuersatz ausserhalb 19 % / 7 % wird nicht festgeschrieben', async () => {
  // Ohne Hinweis auf den Grund der Steuerbefreiung (§ 14 Abs. 4 Nr. 8 UStG) waere die Rechnung unvollstaendig.
  const { token } = await h.seedBasis();
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Steuerfrei?', menge: 1, einzelpreis_netto: 100, mwst_satz: 0 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 400);
  assert.match(f.body.error, /Steuersatz/);
});

test('Festgeschriebene Rechnung enthaelt alle Pflichtangaben nach § 14 Abs. 4 UStG', async () => {
  const { token } = await h.seedBasis({ ust_id: 'DE123456789' });
  const e = await entwurf(token, {
    empfaenger: EMPF_VOLL,
    leistungsdatum: '2026-08-20',
    positionen: [{ bezeichnung: 'Raederwechsel komplett', menge: 4, einheit: 'Stk', einzelpreis_netto: 25, mwst_satz: 19 }]
  });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const r = f.body;

  // 1./2. Aussteller mit Anschrift + Steuernummer/USt-IdNr (eingefrorener Snapshot)
  assert.ok(r.aussteller.firmenname && r.aussteller.strasse && r.aussteller.plz && r.aussteller.ort, 'Aussteller-Anschrift');
  assert.ok(r.aussteller.steuernummer || r.aussteller.ust_id, 'Steuernummer oder USt-IdNr.');
  // 3. Leistungsempfaenger
  assert.equal(r.empfaenger_name, 'Max Mustermann');
  assert.ok(r.empfaenger_strasse && r.empfaenger_plz && r.empfaenger_ort, 'Empfaenger-Anschrift');
  // 4. Fortlaufende Nummer  5. Ausstellungsdatum  6. Leistungszeitpunkt
  assert.match(r.rechnungsnr, /^RE-\d{4}-\d{4}$/);
  assert.match(r.rechnungsdatum, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.leistungsdatum, '2026-08-20');
  // 7. Menge und Art der Leistung
  const pos = (await h.query('SELECT * FROM rechnung_positionen WHERE rechnung_id=$1 ORDER BY position', [r.id])).rows;
  assert.equal(pos.length, 1);
  assert.equal(pos[0].bezeichnung, 'Raederwechsel komplett');
  assert.equal(Number(pos[0].menge), 4);
  assert.equal(pos[0].einheit, 'Stk');
  // 8. Entgelt nach Steuersaetzen aufgeschluesselt  9. Steuersatz + Steuerbetrag
  assert.equal(Number(r.netto_summe), 100);
  assert.equal(Number(r.mwst_summe), 19);
  assert.equal(Number(r.brutto_summe), 119);
  assert.deepEqual(r.mwst_aufschluesselung, [{ satz: 19, netto: 100, mwst: 19 }]);
  // Beleg (PDF) wurde erzeugt und liegt vor
  assert.ok(r.pdf_pfad && fs.existsSync(r.pdf_pfad) && fs.statSync(r.pdf_pfad).size > 1000, 'PDF-Beleg vorhanden');
  assert.ok(r.pdf_pfad.startsWith(h.PDF_DIR), 'Test-PDFs duerfen nur im Testordner landen');
  // Zahlungsziel aus den Einstellungen
  assert.ok(r.faelligkeit > r.rechnungsdatum, 'Faelligkeit liegt nach dem Rechnungsdatum');
});

test('Der PDF-Beleg zeigt alle Pflichtangaben, inkl. Entgelt je Steuersatz', async () => {
  const { token } = await h.seedBasis({ ust_id: 'DE123456789' });
  const e = await entwurf(token, {
    empfaenger: EMPF_VOLL,
    positionen: [
      { bezeichnung: 'Raederwechsel', menge: 1, einheit: 'Stk', einzelpreis_netto: 100, mwst_satz: 19 },
      { bezeichnung: 'Ventile', menge: 4, einheit: 'Stk', einzelpreis_netto: 2.5, mwst_satz: 7 }
    ]
  });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));

  const text = h.pdfText(f.body.pdf_pfad);
  if (text === null) { console.log('Hinweis: pdftotext nicht vorhanden - PDF-Inhalt nicht geprueft.'); return; }
  assert.ok(text.includes(f.body.rechnungsnr), 'Rechnungsnummer');
  assert.ok(text.includes('28.') || /\d{2}\.\d{2}\.\d{4}/.test(text), 'Datum in deutscher Schreibweise');
  assert.ok(text.includes('Max Mustermann') && text.includes('Musterstadt'), 'Leistungsempfaenger');
  assert.ok(text.includes('123/456/78901') || text.includes('DE123456789'), 'Steuernummer/USt-IdNr.');
  assert.ok(text.includes('Raederwechsel') && text.includes('Ventile'), 'Art der Leistung');
  // Entgelt UND Steuerbetrag je Steuersatz (§ 14 Abs. 4 Nr. 8 UStG)
  assert.ok(/19 %\s*MwSt auf\s*100,00/.test(text), 'Entgelt zum Satz 19 % ausgewiesen');
  assert.ok(/7 %\s*MwSt auf\s*10,00/.test(text), 'Entgelt zum Satz 7 % ausgewiesen');
  assert.ok(text.includes('19,00') && text.includes('0,70'), 'Steuerbetraege je Satz');
  assert.ok(text.includes('129,70'), 'Gesamtbetrag');
});

test('Bei Endpreisen zeigt der Beleg Brutto-Spalten, die exakt aufgehen', async () => {
  // Mit Netto-Spalten stuende dort ein gerundeter Einzelpreis: 3 x 36,97 = 110,91, waehrend die
  // Zeile 110,92 betraegt. Bei einem Betrieb mit Endpreisen wird deshalb brutto ausgewiesen.
  const { token } = await h.seedBasis({ preise_inkl_mwst: true });
  const e = await entwurf(token, {
    empfaenger: EMPF_VOLL,
    positionen: [{ bezeichnung: 'Raederwechsel', menge: 3, einheit: 'Stk', einzelpreis_brutto: 44, mwst_satz: 19 }]
  });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));

  const text = h.pdfText(f.body.pdf_pfad);
  if (text === null) { console.log('Hinweis: pdftotext nicht vorhanden - PDF-Inhalt nicht geprueft.'); return; }
  assert.ok(text.includes('Einzel brutto') && !text.includes('Einzel netto'), 'Brutto-Spalten');
  assert.ok(/3 Stk\s+44,00 €/.test(text), 'Einzelpreis ist der Endpreis');
  assert.ok(text.includes('132,00'), 'Zeilensumme geht exakt auf (3 x 44,00)');
  // Das nach Steuersaetzen aufgeschluesselte Entgelt bleibt Pflicht und steht im Summenblock.
  assert.ok(/19 %\s*MwSt auf\s*110,92/.test(text), 'Entgelt je Steuersatz weiterhin ausgewiesen');
  assert.ok(text.includes('21,08'), 'Steuerbetrag');
});

test('Firmenkunde: die Firma ist Empfaenger, die Person nur Ansprechpartner', async () => {
  const { token } = await h.seedBasis();
  const e = await entwurf(token, {
    empfaenger: { anrede: 'Frau', vorname: 'Erika', nachname: 'Musterfrau', firma: 'Musterfuhrpark GmbH',
                  strasse: 'Flottenweg 9', plz: '12345', ort: 'Musterstadt' },
    positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 300, mwst_satz: 19 }]
  });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const text = h.pdfText(f.body.pdf_pfad);
  if (text === null) return;
  assert.ok(text.includes('Musterfuhrpark GmbH'), 'Firma als Empfaenger');
  assert.ok(text.includes('z. Hd. Frau Erika Musterfrau'), 'Person als Ansprechpartner gekennzeichnet');
});

test('Privatkunde bekommt keine z.-Hd.-Zeile', async () => {
  const { token } = await h.seedBasis();
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  const text = h.pdfText(f.body.pdf_pfad);
  if (text === null) return;
  assert.ok(text.includes('Max Mustermann') && !text.includes('z. Hd.'));
});

test('Bei Nettopreisen bleiben die Netto-Spalten', async () => {
  const { token } = await h.seedBasis({ preise_inkl_mwst: false });
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 2, einheit: 'Stk', einzelpreis_netto: 50, mwst_satz: 19 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200);
  const text = h.pdfText(f.body.pdf_pfad);
  if (text === null) return;
  assert.ok(text.includes('Einzel netto') && !text.includes('Einzel brutto'));
  assert.ok(/2 Stk\s+50,00 €/.test(text) && text.includes('100,00'), 'Netto-Zeile geht auf');
});

test('MwSt wird je Steuersatz aggregiert, Rundung je Zeile', async () => {
  const { token } = await h.seedBasis();
  const e = await entwurf(token, {
    empfaenger: EMPF_VOLL,
    positionen: [
      { bezeichnung: 'Arbeit', menge: 3, einzelpreis_netto: 33.33, mwst_satz: 19 },
      { bezeichnung: 'Ware', menge: 1, einzelpreis_netto: 50, mwst_satz: 7 }
    ]
  });
  assert.equal(Number(e.netto_summe), 149.99);
  assert.equal(Number(e.brutto_summe), 172.49);   // 118,99 + 53,50
  assert.equal(Number(e.mwst_summe), 22.50);
  const auf = e.mwst_aufschluesselung.slice().sort((a, b) => b.satz - a.satz);
  assert.deepEqual(auf, [{ satz: 19, netto: 99.99, mwst: 19 }, { satz: 7, netto: 50, mwst: 3.5 }]);
});

test('Bruttopreis als Endpreis: Betrag bleibt exakt, auch bei Menge groesser eins', async () => {
  const { token } = await h.seedBasis();
  const e = await entwurf(token, {
    empfaenger: EMPF_VOLL,
    positionen: [{ bezeichnung: 'Raederwechsel', menge: 4, einheit: 'Stk', einzelpreis_brutto: 11, mwst_satz: 19 }]
  });
  assert.equal(Number(e.brutto_summe), 44.00, '4 x 11,00 EUR brutto bleiben 44,00 EUR');
  assert.equal(Number(e.mwst_summe), 7.03);
  assert.equal(Number(e.netto_summe), 36.97);

  const pos = (await h.query('SELECT * FROM rechnung_positionen WHERE rechnung_id=$1', [e.id])).rows[0];
  assert.equal(Number(pos.zeilen_brutto), 44.00);
  assert.equal(Number(pos.zeilen_netto), 36.97);
});

test('Netto- und Bruttopositionen lassen sich in einer Rechnung mischen', async () => {
  const { token } = await h.seedBasis();
  const e = await entwurf(token, {
    empfaenger: EMPF_VOLL,
    positionen: [
      { bezeichnung: 'Endpreis-Leistung', menge: 1, einzelpreis_brutto: 44, mwst_satz: 19 },
      { bezeichnung: 'Netto erfasst', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }
    ]
  });
  assert.equal(Number(e.brutto_summe), 163.00, '44,00 + 119,00');
  assert.equal(Number(e.netto_summe), 136.97);
  assert.equal(Number(e.mwst_summe), 26.03);
});

test('Vom Client mitgeschickte Summen werden ignoriert', async () => {
  const { token } = await h.seedBasis();
  const e = await entwurf(token, {
    empfaenger: EMPF_VOLL,
    netto_summe: 1, mwst_summe: 0, brutto_summe: 1,
    positionen: [{ bezeichnung: 'Leistung', menge: 2, einzelpreis_netto: 100, mwst_satz: 19, zeilen_netto: 1, zeilen_brutto: 1 }]
  });
  assert.equal(Number(e.netto_summe), 200);
  assert.equal(Number(e.brutto_summe), 238);
  const pos = (await h.query('SELECT zeilen_netto, zeilen_brutto FROM rechnung_positionen WHERE rechnung_id=$1', [e.id])).rows[0];
  assert.equal(Number(pos.zeilen_netto), 200);
  assert.equal(Number(pos.zeilen_brutto), 238);
});

test('Aussteller- und Empfaengerdaten sind nach dem Festschreiben eingefroren', async () => {
  const { token } = await h.seedBasis();
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });
  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200);

  await h.query("UPDATE einstellungen SET firmenname='Neuer Name', steuernummer='999/999/99999'");
  const nach = (await h.api(token, 'GET', '/api/rechnungen/' + e.id)).body;
  assert.equal(nach.aussteller.firmenname, 'Testbetrieb Rechnungswesen', 'Snapshot darf sich nicht nachtraeglich aendern');
  assert.equal(nach.aussteller.steuernummer, '123/456/78901');
});

test('E-Rechnung (XRechnung) nur fuer festgeschriebene Rechnungen, mit Pflichtangaben', async () => {
  const { token } = await h.seedBasis({ ust_id: 'DE123456789' });
  const e = await entwurf(token, { empfaenger: EMPF_VOLL, positionen: [{ bezeichnung: 'Leistung', menge: 1, einzelpreis_netto: 100, mwst_satz: 19 }] });

  const zuFrueh = await h.api(token, 'GET', '/api/rechnungen/' + e.id + '/xrechnung');
  assert.equal(zuFrueh.status, 400);

  const f = await h.api(token, 'POST', '/api/rechnungen/' + e.id + '/festschreiben');
  assert.equal(f.status, 200);
  const xml = await h.api(token, 'GET', '/api/rechnungen/' + e.id + '/xrechnung');
  assert.equal(xml.status, 200);
  const s = String(xml.body);
  assert.ok(s.includes('<cbc:ID>' + f.body.rechnungsnr + '</cbc:ID>'), 'Rechnungsnummer im XML');
  assert.ok(s.includes('<cbc:IssueDate>' + f.body.rechnungsdatum + '</cbc:IssueDate>'), 'Ausstellungsdatum im XML');
  assert.ok(s.includes('DE123456789'), 'USt-IdNr. im XML');
  assert.ok(s.includes('119.00'), 'Bruttobetrag im XML');
});
