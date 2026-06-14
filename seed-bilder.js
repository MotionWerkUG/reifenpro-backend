'use strict';
// Einmalig: laedt die ausgewaehlten Business-Bilder, verarbeitet sie ueber die
// zentrale Pipeline und legt sie in /var/www/schroeder-homepage/uploads ab.
const fs = require('fs');
const path = require('path');
const { verarbeite } = require('./src/lib/bildverarbeitung');

const DIR = '/var/www/schroeder-homepage/uploads';
const BASE = 'https://images.unsplash.com/photo-';

const BILDER = [
  { datei: 'hero.jpg',        format: 'hero',   id: '1542377281-73d08e3a10aa' }, // sportliche Alufelge
  { datei: 'werkstatt.jpg',   format: 'inhalt', id: '1619505372149-07875c35b313' }, // Reifenservice-Werkstatt
  { datei: 'raederwechsel.jpg', format: 'inhalt', id: '1593699199342-59b40e08f0ac' }, // Schlagschrauber an Rad
  { datei: 'einlagerung.jpg', format: 'inhalt', id: '1578844251758-2f71da64c96f' }, // gestapelte Winterreifen
  { datei: 'felgen.jpg',      format: 'inhalt', id: '1611633235555-45e252fe48c8' }, // Felgen im Regal
  { datei: 'fahrwerk.jpg',    format: 'inhalt', id: '1640021042525-5610f9f75444' }, // Querlenker/Stossdaempfer
  { datei: 'bremsen.jpg',     format: 'inhalt', id: '1613214150384-14921ff659b2' }  // Bremsscheibe + Sattel
];

(async () => {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  for (const b of BILDER) {
    const url = BASE + b.id + '?w=2000&q=80';
    const resp = await fetch(url);
    if (!resp.ok) { console.error('FEHLER ' + b.datei + ': HTTP ' + resp.status); continue; }
    const buf = Buffer.from(await resp.arrayBuffer());
    const out = await verarbeite(buf, b.format);
    fs.writeFileSync(path.join(DIR, b.datei), out);
    console.log(b.datei + ' OK (' + Math.round(out.length / 1024) + ' KB)');
  }
})().catch(e => { console.error(e); process.exit(1); });
