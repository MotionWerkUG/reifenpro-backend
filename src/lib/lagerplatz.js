'use strict';
// Einheitliche Schreibweise fuer Lagerplaetze.
//
// Warum: Das Eingabefeld im Admin ist Freitext ("Vorschlag - frei aenderbar"), die
// Doppelbelegungssperre in einlagerungen.js vergleicht aber Zeichenketten. Der Lagerplan
// erzeugt seine Plaetze immer zweistellig (lager.js: String(i).padStart(2,'0') -> "A-01-07").
// Wer den Vorschlag von Hand zu "A-01-7" aendert, legt damit fuer das System einen ANDEREN
// Platz an: Die Belegtpruefung greift nicht, im Lagerplan bleibt die Kachel weiss, und der
// Platz ist trotzdem belegt. Genau dieser Fall kostet im Saisonbetrieb einen Radsatz.
//
// Regel: trimmen, Mehrfach-Leerzeichen zusammenziehen, Grossschreibung, und jedes rein
// numerische Segment zwischen den Bindestrichen auf zwei Stellen auffuellen. Damit landen
// "a-1-7", "A-01-7" und " A-01-07 " alle auf "A-01-07". Segmente mit Buchstaben
// (z. B. "Keller-Regal A-3" -> "KELLER-REGAL A-03") bleiben inhaltlich unangetastet.
function normalisiereLagerplatz(wert) {
  const roh = String(wert == null ? '' : wert).trim().replace(/\s+/g, ' ').toUpperCase();
  if (!roh) return '';
  return roh.split('-').map(function (teil) {
    const t = teil.trim();
    // Nur reine Zahlen auffuellen, und nur einstellige: "100" bleibt "100".
    return /^\d$/.test(t) ? '0' + t : t;
  }).join('-');
}

// Wie viele Saetze duerfen auf diesen Platz? Ergibt sich aus dem Regal ("A-01-07" -> Ort A,
// Regal 01). Ist der Platz keinem konfigurierten Regal zuzuordnen, gilt 1 — dann verhaelt sich
// alles wie bisher und niemand legt versehentlich zwei Saetze uebereinander.
async function kapazitaetFuer(client, lagerplatz) {
  const teile = String(lagerplatz || '').split('-');
  if (teile.length < 3) return 1;
  const ort = teile[0];
  const regal = teile.slice(1, teile.length - 1).join('-');
  const r = await client.query(
    `SELECT r.plaetze_kapazitaet FROM lager_regale r JOIN lager_orte o ON o.id = r.ort_id
      WHERE UPPER(o.name) = $1 AND UPPER(r.name) = $2 LIMIT 1`,
    [ort, regal]);
  const k = r.rows[0] && r.rows[0].plaetze_kapazitaet;
  return Number.isInteger(k) && k > 0 ? k : 1;
}

module.exports = { normalisiereLagerplatz, kapazitaetFuer };
