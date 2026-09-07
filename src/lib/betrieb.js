'use strict';
// Erkennt, ob dieser Prozess die PRODUKTIONSINSTANZ ist.
//
// Warum es das gibt: Am 07.09.2026 hat eine seit Tagen laufende Testinstanz eines anderen
// Bereichs um 03:15 die oeffentliche Website neu erzeugt — aus ihrer Testdatenbank, in der
// keine Homepage-Abschnitte stehen. Ergebnis: Die Startseite verlor Hero, Leistungen,
// Oeffnungszeiten und Kontakt und zeigte nur noch die fest im Code stehenden Bloecke.
// Die Ursache war nicht der Fehler eines Einzelnen: JEDE Instanz registriert beim Start
// dieselben zeitgesteuerten Auftraege und schreibt auf dieselben absoluten Pfade. Eine
// Testinstanz war damit von der echten nicht zu unterscheiden.
//
// Die Unterscheidung: Die .env im Projektordner ist die Produktionskonfiguration. dotenv
// ueberschreibt bereits gesetzte Umgebungsvariablen NICHT — eine Testinstanz, die mit
// eigenem DB_NAME oder PORT gestartet wird, behaelt ihre Werte und weicht damit von der
// .env ab. Genau daran erkennen wir sie.
const fs = require('fs');
const path = require('path');

function envDatei() {
  const p = path.join(__dirname, '..', '..', '.env');
  const raus = {};
  try {
    fs.readFileSync(p, 'utf8').split('\n').forEach(function (z) {
      const m = z.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) raus[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* keine .env lesbar -> unten als "nicht Produktion" behandelt */ }
  return raus;
}

let gemeldet = false;
function istProduktionsinstanz() {
  const soll = envDatei();
  if (!soll.DB_NAME || !soll.PORT) return false;
  const ok = process.env.DB_NAME === soll.DB_NAME && String(process.env.PORT) === String(soll.PORT);
  if (!ok && !gemeldet) {
    gemeldet = true;
    console.log('[Betrieb] Testinstanz erkannt (DB=' + process.env.DB_NAME + ', Port=' + process.env.PORT +
      '; Produktion waere DB=' + soll.DB_NAME + ', Port=' + soll.PORT + '). Zeitgesteuerte Auftraege und ' +
      'Schreibzugriffe auf die oeffentliche Website bleiben aus.');
  }
  return ok;
}

module.exports = { istProduktionsinstanz };
