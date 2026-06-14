'use strict';
// Erzeugt /var/www/schroeder-homepage/index.html aus DB-Sektionen + Firmendaten.
require('dotenv').config();
const fs = require('fs');
const { query } = require('./src/db/index');
const { renderHomepage } = require('./src/lib/homepage-render');

const ZIEL = '/var/www/schroeder-homepage/index.html';

(async () => {
  const sektionen = (await query('SELECT * FROM homepage_sektionen ORDER BY sortierung')).rows;
  const f = (await query('SELECT * FROM einstellungen ORDER BY id LIMIT 1')).rows[0] || {};
  const html = renderHomepage(sektionen, f);
  fs.writeFileSync(ZIEL, html);
  console.log('Homepage erzeugt:', ZIEL, '(' + html.length + ' Bytes, ' + sektionen.length + ' Sektionen)');
  process.exit(0);
})().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
