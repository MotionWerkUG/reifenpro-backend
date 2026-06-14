'use strict';
// Erzeugt die statische Homepage neu (von CMS + Einstellungen aufgerufen).
// Liegt auf dem Server unter src/lib/homepage-generate.js
const fs = require('fs');
const { query } = require('../db/index');
const { renderHomepage } = require('./homepage-render');

const ZIEL = '/var/www/schroeder-homepage/index.html';

async function regenerate() {
  const sektionen = (await query('SELECT * FROM homepage_sektionen ORDER BY sortierung')).rows;
  const f = (await query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
  fs.writeFileSync(ZIEL, renderHomepage(sektionen, f));
}

module.exports = { regenerate, ZIEL };
