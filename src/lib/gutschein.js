'use strict';
// Gutscheine und ihre gestaffelten Nachlaesse -- EINE Quelle fuer alle Buchungswege.
//
// Der Flyer verspricht 25 % auf die Reifeneinlagerung und 10 % auf alles andere. Die Zuordnung
// "welche Leistung bekommt welchen Satz" darf genau einmal getroffen werden: hier. Wuerden
// Gaeste-Buchung, Portal-Buchung und Rechnung sie unabhaengig voneinander nachbauen, liefen sie
// irgendwann auseinander -- und der Kunde saehe im Buchungsassistenten einen anderen Betrag als
// auf seiner Rechnung.
//
// Der ermittelte Satz wird je Position im Termin eingefroren (`leistungen[].rabatt_prozent`).
// Aendert der Betrieb spaeter die Regeln, bleibt eine bereits gebuchte Zusage unberuehrt.
const { query } = require('../db/index');

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Code normalisieren: Steuerzeichen (inkl. NUL -> sonst Postgres-Fehler) und Leerzeichen raus,
// auf 40 Zeichen begrenzt. Der Vergleich in der Abfrage ist ohnehin UPPER().
function normCode(s) { return String(s == null ? '' : s).replace(/[\s\x00-\x1F]/g, '').slice(0, 40); }

// Gueltigen Gutschein laden (aktiv, nicht abgelaufen) -- oder null. Ein unbekannter oder
// abgelaufener Code ist KEIN Fehler: Die Buchung laeuft dann ohne Nachlass weiter, statt zu
// scheitern. Wer sich vertippt, soll seinen Termin trotzdem bekommen.
async function ladeGutschein(code) {
  const c = normCode(code);
  if (!c) return null;
  const g = (await query(
    `SELECT id, code, rabatt_prozent FROM gutscheine
      WHERE UPPER(code)=UPPER($1) AND aktiv=true AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE)`,
    [c])).rows[0];
  return g || null;
}

// Rabattsatz je Artikel ermitteln. Spezifischste Regel gewinnt: Regel fuer genau diese Leistung
// vor Auffangregel (artikel_id IS NULL) vor dem Standardsatz des Gutscheins. Bestandscodes ohne
// Regeln behalten damit ihr bisheriges Verhalten.
async function saetzeFuer(gutschein, artikelIds) {
  const ergebnis = {};
  if (!gutschein) return ergebnis;
  const regeln = (await query('SELECT artikel_id, rabatt_prozent FROM gutschein_regeln WHERE gutschein_id=$1', [gutschein.id])).rows;
  const jeArtikel = {}; let auffang = null;
  regeln.forEach((r) => {
    if (r.artikel_id) jeArtikel[r.artikel_id] = Number(r.rabatt_prozent);
    else auffang = Number(r.rabatt_prozent);
  });
  const standard = auffang != null ? auffang : (Number(gutschein.rabatt_prozent) || 0);
  (artikelIds || []).forEach((id) => {
    const satz = jeArtikel[id] != null ? jeArtikel[id] : standard;
    ergebnis[id] = Math.min(Math.max(satz, 0), 100);
  });
  return ergebnis;
}

// Nachlass aus fertigen Positionen berechnen. Rechenregeln wortgleich mit dem Rechnungswesen,
// damit Assistent, Portal, Bestaetigungsmail und Beleg denselben Betrag zeigen:
//  (1) Der Nachlass rechnet auf den BRUTTO-Preis (25 % von 40,00 sind 10,00 -- auf den Nettowert
//      gerechnet kaeme ein anderer Betrag heraus als auf dem Flyer steht).
//  (2) Gerundet wird EINMAL je Gruppe auf die Summe, nicht je Zeile.
//  (3) Gruppiert wird nach Rabattsatz UND Steuersatz (heute alles 19 %, der Aufbau muss aber
//      mehrere Saetze aushalten).
// Erwartet je Position: { zeilen_brutto, mwst_satz, rabatt_prozent }.
function rabattAusPositionen(positionen) {
  const gruppen = {};
  (positionen || []).forEach((p) => {
    const satz = Number(p.rabatt_prozent || 0);
    if (!satz) return;
    const key = satz + '|' + Number(p.mwst_satz != null ? p.mwst_satz : 19);
    gruppen[key] = (gruppen[key] || 0) + Number(p.zeilen_brutto || 0);
  });
  const zeilen = Object.keys(gruppen).map((key) => {
    const satz = Number(key.split('|')[0]);
    return { satz: satz, betrag: round2(gruppen[key] * satz / 100) };
  }).sort((a, b) => b.satz - a.satz);
  const summe = round2(zeilen.reduce((s, z) => s + z.betrag, 0));
  return { zeilen: zeilen, summe: summe };
}

module.exports = { normCode, ladeGutschein, saetzeFuer, rabattAusPositionen, round2 };
