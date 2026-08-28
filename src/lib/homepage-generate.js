'use strict';
// Erzeugt die statische Homepage neu (von CMS + Einstellungen aufgerufen).
// Liegt auf dem Server unter src/lib/homepage-generate.js
const fs = require('fs');
const { query } = require('../db/index');
const { renderHomepage, renderWartung } = require('./homepage-render');
const { regulaereWoche, besondereTageAbHeute } = require('./oeffnung');

const ZIEL = '/var/www/schroeder-homepage/index.html';
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
