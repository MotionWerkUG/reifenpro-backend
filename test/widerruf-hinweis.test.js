'use strict';
// Hinweis auf das Widerrufsrecht beim Abrechnen.
//
// Wurde ein Fernabsatzvertrag innerhalb der 14-taegigen Widerrufsfrist abgearbeitet, ohne dass
// der Kunde dem vorzeitigen Leistungsbeginn zugestimmt hat, kann er nach getaner Arbeit
// widerrufen und schuldet nichts (§ 357a Abs. 2 BGB). Die Rechnung ist trotzdem korrekt und
// muss erstellt werden — deshalb wird HINGEWIESEN und nicht gesperrt.
//
// Ebenso wichtig wie der Hinweis selbst: dass er NICHT kommt, wo er nicht hingehoert. Ein
// Fehlalarm entwertet ihn fuer die Faelle, in denen er zaehlt.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helper');

let token;

test.before(async () => { await h.starteApp(); });
test.after(async () => { await h.stoppeApp(); });
test.beforeEach(async () => { await h.leereDaten(); token = (await h.seedBasis({ preise_inkl_mwst: true })).token; });

const LEISTUNGEN = [
  { bezeichnung: 'Räderwechsel', mwst_satz: 19, zeilen_brutto: 39, zeilen_netto: 32.77,
    grundpreis_netto: 32.77, zuschlag_netto: 0, rabatt_prozent: 0 }
];

// tageVoraus: Termin relativ zu heute. vertragVorTagen: wann der Vertrag geschlossen wurde.
async function seedTermin(opt) {
  const o = opt || {};
  const kunde = await h.seedKunde();
  if (o.kundentyp) await h.query('UPDATE kunden SET kundentyp=$1 WHERE id=$2', [o.kundentyp, kunde]);
  const t = await h.query(
    `INSERT INTO termine (datum, uhrzeit_von, uhrzeit_bis, termin_typ, status, kunden_id, leistungen,
                          vorzeitige_leistung, erstellt_am)
     VALUES ((CURRENT_DATE + ($1 || ' days')::interval)::date, '09:00', '10:00', 'Raederwechsel',
             'abgeschlossen', $2, $3, $4, NOW() - ($5 || ' days')::interval) RETURNING id`,
    [String(o.tageVoraus == null ? 0 : o.tageVoraus), kunde, JSON.stringify(LEISTUNGEN),
     o.zustimmung === true, String(o.vertragVorTagen == null ? 0 : o.vertragVorTagen)]);
  return t.rows[0].id;
}

test('Termin in der Widerrufsfrist ohne Zustimmung: Hinweis beim Entwurf und beim Festschreiben', async () => {
  // Vertrag heute geschlossen, Termin morgen — die Frist laeuft noch 13 Tage weiter.
  const terminId = await seedTermin({ tageVoraus: 1, vertragVorTagen: 0, zustimmung: false });

  const entwurf = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + terminId);
  assert.equal(entwurf.status, 201, JSON.stringify(entwurf.body));
  assert.ok(entwurf.body.widerruf_hinweis, 'Hinweis fehlt beim Entwurf');
  assert.match(entwurf.body.widerruf_hinweis, /Widerrufsfrist/);
  assert.match(entwurf.body.widerruf_hinweis, /357a/, 'die Norm wird genannt');

  const f = await h.api(token, 'POST', '/api/rechnungen/' + entwurf.body.id + '/festschreiben');
  assert.equal(f.status, 200, 'Der Hinweis darf das Festschreiben NICHT verhindern: ' + JSON.stringify(f.body));
  assert.ok(f.body.rechnungsnr, 'die Rechnung bekommt ihre Nummer');
  assert.ok(f.body.widerruf_hinweis, 'Hinweis fehlt beim Festschreiben');

  // Der Vorgang muss nachvollziehbar sein, nicht nur im Bildschirm aufblitzen.
  const log = await h.query("SELECT count(*)::int AS n FROM audit_log WHERE aktion='rechnung.widerruf_hinweis'");
  assert.equal(log.rows[0].n, 1, 'Hinweis wurde protokolliert');
});

test('Mit dokumentierter Zustimmung kommt kein Hinweis', async () => {
  const terminId = await seedTermin({ tageVoraus: 1, vertragVorTagen: 0, zustimmung: true });
  const entwurf = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + terminId);
  assert.equal(entwurf.status, 201);
  assert.equal(entwurf.body.widerruf_hinweis, undefined, 'kein Hinweis trotz Frist: ' + entwurf.body.widerruf_hinweis);
});

test('Firmenkunde bekommt keinen Hinweis — das Widerrufsrecht steht Verbrauchern zu', async () => {
  const terminId = await seedTermin({ tageVoraus: 1, vertragVorTagen: 0, zustimmung: false, kundentyp: 'firma' });
  const entwurf = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + terminId);
  assert.equal(entwurf.status, 201);
  assert.equal(entwurf.body.widerruf_hinweis, undefined, 'Fehlalarm bei einem Firmenkunden');
});

test('Ist die Frist beim Termin laengst abgelaufen, kommt kein Hinweis', async () => {
  // Vertrag vor 30 Tagen geschlossen, Termin heute — die Widerrufsfrist war lange vorbei.
  const terminId = await seedTermin({ tageVoraus: 0, vertragVorTagen: 30, zustimmung: false });
  const entwurf = await h.api(token, 'POST', '/api/rechnungen/aus-termin/' + terminId);
  assert.equal(entwurf.status, 201);
  assert.equal(entwurf.body.widerruf_hinweis, undefined, 'Fehlalarm bei abgelaufener Frist');
});

test('Eine Rechnung ohne Termin loest weder Hinweis noch Fehler aus', async () => {
  const r = await h.api(token, 'POST', '/api/rechnungen', {
    empfaenger: { vorname: 'Max', nachname: 'Mustermann', strasse: 'Musterweg 2', plz: '54321', ort: 'Musterstadt' },
    positionen: [{ bezeichnung: 'Auswuchten', menge: 1, einzelpreis_brutto: 25, mwst_satz: 19 }]
  });
  assert.equal(r.status, 201);
  const f = await h.api(token, 'POST', '/api/rechnungen/' + r.body.id + '/festschreiben');
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(f.body.widerruf_hinweis, undefined);
});
