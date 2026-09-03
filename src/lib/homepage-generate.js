'use strict';
// Erzeugt die statische Homepage neu (von CMS + Einstellungen aufgerufen).
// Liegt auf dem Server unter src/lib/homepage-generate.js
const fs = require('fs');
const { query } = require('../db/index');
const { renderHomepage, renderWartung } = require('./homepage-render');
const { regulaereWoche, besondereTageAbHeute } = require('./oeffnung');
const { bannerStatus } = require('./aktion');

// Zielpfad der erzeugten Seite. Im Betrieb immer die echte Website; ueberschreibbar per
// HOMEPAGE_ZIEL, damit eine Testinstanz (eigene Datenbank, eigener Port) die Live-Datei nicht
// mit Testdaten ueberschreibt. In der produktiven .env ist die Variable NICHT gesetzt.
const ZIEL = process.env.HOMEPAGE_ZIEL || '/var/www/schroeder-homepage/index.html';
// Wartungs-/Coming-Soon-Modus: existiert diese Flag-Datei, wird STATT der Website die
// Coming-Soon-Seite erzeugt (bleibt so bei jeder Neugenerierung erhalten). Ausschalten:
// Datei loeschen + einmal regenerate() ausfuehren.
const WARTUNG_FLAG = '/var/www/schroeder-homepage/.wartung';

async function regenerate() {
  const f = (await query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
  if (fs.existsSync(WARTUNG_FLAG)) {
    fs.writeFileSync(ZIEL, renderWartung(f));
    return;
  }
  // Aktionsbanner nur ausspielen, wenn ein hinterlegter Gutschein-Code auch wirklich noch gilt.
  // Sonst bewirbt die Seite einen Rabatt, den die Buchung anschliessend verweigert. Der
  // naechtliche Lauf (03:15) heilt das von selbst in der Nacht nach dem Ablauf.
  // Laesst sich die Gueltigkeit nicht pruefen, faellt ein Banner MIT Code weg — dieselbe
  // Entscheidung wie in der Preis-API, sonst zeigten Startseite und Preisseite bei einer
  // Stoerung Unterschiedliches. Ein Banner ohne Code ist nicht betroffen, dafuer wird gar
  // nicht erst gefragt.
  try {
    const st = await bannerStatus(f);
    if (!st.zeigen) f.aktion_aktiv = false;
  } catch (e) { if (f.aktion_code) f.aktion_aktiv = false; }
  const sektionen = (await query('SELECT * FROM homepage_sektionen ORDER BY sortierung')).rows;
  let fonts = [];
  try { fonts = (await query('SELECT familie, datei, format FROM homepage_fonts ORDER BY erstellt_am')).rows; }
  catch (e) { /* Tabelle evtl. noch nicht vorhanden -> Standardschriften */ }
  // Öffnungszeiten aus dem Wochenraster + kommende Feiertage/Betriebsurlaub (60 Tage).
  // Faellt eines davon aus, rendert die Seite mit den Alt-Feldern weiter (keine leere Seite).
  let oz = {};
  try { oz = { woche: await regulaereWoche(), besondere: await besondereTageAbHeute(60) }; }
  catch (e) { /* Tabellen evtl. noch nicht vorhanden -> Rueckfall auf Alt-Felder */ }
  fs.writeFileSync(ZIEL, renderHomepage(sektionen, f, fonts, oz));
}

module.exports = { regenerate, ZIEL, WARTUNG_FLAG };
