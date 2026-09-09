'use strict';
// Anbindung an die ReifenPro Kasse (eigene AutoKasse-Instanz, eigene Firma, eigener Schluessel).
// Vertrag: /home/deploy/projekte/_koordination/CONNECTOR-VERTRAG-REIFENPRO.md
//
// Grundsatz: Rechnungen entstehen ausschliesslich hier, die Kasse fuehrt Kassenbelege und
// Zahlungen. Wir melden eine Zahlung, sie bucht und signiert sie und gibt den Beleg aus.

const ZEITGRENZE_MS = 8000;

function basis() { return (process.env.KASSE_URL || '').replace(/\/+$/, ''); }
function schluessel() { return process.env.KASSE_ERP_KEY || ''; }

// Ohne Adresse oder Schluessel ist die Anbindung schlicht nicht eingerichtet. Der Aufrufer
// soll das unterscheiden koennen von "Kasse antwortet nicht".
function konfiguriert() { return !!(basis() && schluessel()); }

// Zustand der Kasse, OHNE Schluessel und ohne Anmeldung abfragbar. Wichtig ist hier vor allem
// tseKonfiguriert: Ohne technische Sicherheitseinrichtung darf keine Barbuchung entstehen
// (§ 146a AO). Die Kasse selbst faengt einen TSE-AUSFALL bewusst ab und laeuft weiter — das ist
// bei einem Ausfall richtig, schuetzt aber nicht davor, dass ueberhaupt nie eine TSE
// eingerichtet war. Diesen Riegel setzen wir deshalb auf unserer Seite: Wir senden keine
// Buchung, von der wir wissen, dass sie nicht signiert werden kann.
//
// Kurze Zeitgrenze und eigene Fehlerbehandlung: Eine nicht erreichbare Kasse ist eine STOERUNG
// und darf NICHT als "keine TSE" gedeutet werden — sonst sperrt ein Netzproblem den Tresen.
const ZUSTAND_MS = 2500;

async function zustand() {
  if (!basis()) { const e = new Error('Kassenanbindung ist nicht eingerichtet.'); e.code = 'NICHT_KONFIGURIERT'; throw e; }
  const abbruch = new AbortController();
  const uhr = setTimeout(function () { abbruch.abort(); }, ZUSTAND_MS);
  try {
    const res = await fetch(basis() + '/api/health', { signal: abbruch.signal });
    if (!res.ok) { const e = new Error('Kasse antwortete mit ' + res.status); e.code = 'NICHT_ERREICHBAR'; throw e; }
    return await res.json();
  } catch (err) {
    if (err.code) throw err;
    const e = new Error('Kasse nicht erreichbar: ' + (err.name === 'AbortError' ? 'Zeitgrenze überschritten' : err.message));
    e.code = 'NICHT_ERREICHBAR'; throw e;
  } finally { clearTimeout(uhr); }
}

// true NUR, wenn die Kasse ausdruecklich sagt, dass keine TSE eingerichtet ist. Bei einer
// Stoerung oder einer unbekannten Antwort ist es false — dann entscheidet der eigentliche
// Buchungsversuch, nicht diese Vorpruefung.
async function tseFehltSicher() {
  try {
    const z = await zustand();
    return z && z.tseKonfiguriert === false;
  } catch (e) { return false; }
}

async function anfrage(methode, pfad, koerper) {
  if (!konfiguriert()) { const e = new Error('Kassenanbindung ist nicht eingerichtet.'); e.code = 'NICHT_KONFIGURIERT'; throw e; }
  const abbruch = new AbortController();
  const uhr = setTimeout(function () { abbruch.abort(); }, ZEITGRENZE_MS);
  let res;
  try {
    res = await fetch(basis() + pfad, {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'X-ERP-Key': schluessel() },
      body: koerper === undefined ? undefined : JSON.stringify(koerper),
      signal: abbruch.signal
    });
  } catch (err) {
    const e = new Error('Kasse nicht erreichbar: ' + (err.name === 'AbortError' ? 'Zeitgrenze überschritten' : err.message));
    e.code = 'NICHT_ERREICHBAR'; throw e;
  } finally { clearTimeout(uhr); }

  const text = await res.text();
  let daten = null;
  try { daten = text ? JSON.parse(text) : null; } catch (x) { daten = { rohtext: text }; }
  if (!res.ok) {
    const e = new Error((daten && daten.error) || ('Kasse antwortete mit ' + res.status));
    e.code = 'KASSE_FEHLER'; e.status = res.status; e.daten = daten; throw e;
  }
  return daten || {};
}

// Eine Zahlung an die Kasse melden. `quelleBeleg` ist Pflicht und dient zugleich als
// Idempotenz- und Zuordnungsschluessel: Ein Wiederholungsversuch legt keinen zweiten
// Vorgang an, sondern meldet den bestehenden mit `bereitsVerarbeitet`.
async function meldeZahlung(v) {
  if (!v || !v.quelleBeleg) throw new Error('quelleBeleg fehlt — ohne ihn ist die Meldung nicht zuordenbar.');
  return anfrage('POST', '/api/kassenvorgang', {
    quelleBeleg: v.quelleBeleg,
    ticket: v.ticket || v.quelleBeleg,
    betragArt: v.betragArt,
    betrag: v.betrag,
    zahlart: v.zahlart || 'bar',
    kunde: v.kunde || null,
    kennzeichen: v.kennzeichen || null,
    // Der Kunde steht am Tresen: unmittelbar buchen und signieren (§ 146a AO), nicht in
    // eine Liste offener Vorgaenge legen. Die Kasse macht das atomar — schlaegt es fehl,
    // bleibt kein offener Rest zurueck.
    sofortBuchen: v.sofortBuchen !== false
  });
}

// Bestaetigte Buchungen abholen (Cursor ueber seq). Wird fuer den Abgleich gebraucht:
// Storno an der Kasse, oder ein Beleg, dessen Nummer bei der Meldung noch nicht zurueckkam.
async function holeBuchungen(cursor, limit) {
  const p = new URLSearchParams();
  if (cursor) p.set('cursor', String(cursor));
  p.set('limit', String(limit || 500));
  return anfrage('GET', '/api/export/verkaeufe?' + p.toString());
}

// Belegnummer aus der Antwort ziehen. Die Kasse liefert sie je nach Weg unter
// unterschiedlichen Namen; fehlt sie, wird sie spaeter ueber den Export nachgetragen.
function belegAus(antwort) {
  const a = antwort || {};
  return a.beleg || a.belegnummer || (a.buchung && a.buchung.belegnummer) || null;
}

module.exports = { konfiguriert, zustand, tseFehltSicher, meldeZahlung, holeBuchungen, belegAus };
