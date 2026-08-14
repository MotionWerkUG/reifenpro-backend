'use strict';
// Interaktives Terminal-Werkzeug: Bilder fuer die (buchbaren) Leistungen nacheinander
// hochladen. Fragt je Leistung nach einer Bilddatei, bringt sie mit DERSELBEN
// Bildverarbeitung wie das CMS aufs richtige Format (4:3, 900x675, komprimiertes JPG)
// und setzt die bild_url in der Datenbank.
//
// Ausfuehren als root (der Upload-Ordner /var/www/schroeder-homepage/uploads gehoert root):
//   sudo node scripts/leistungsbilder.js
// Aus dem Ordner reifenpro-homepage starten.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const readline = require('readline');
const { query, pool } = require('../src/db/index');
const { verarbeite } = require('../src/lib/bildverarbeitung');

const UPLOAD_DIR = '/var/www/schroeder-homepage/uploads';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// Zeilen-Puffer: funktioniert interaktiv (Tippen) UND wenn Eingaben gepiped werden.
// Liefert bei Eingabeende (EOF) null zurueck.
const _linien = [];
let _warte = null, _eof = false;
rl.on('line', (l) => { if (_warte) { const w = _warte; _warte = null; w(l); } else _linien.push(l); });
rl.on('close', () => { _eof = true; if (_warte) { const w = _warte; _warte = null; w(null); } });
function frage(q) {
  process.stdout.write(q);
  return new Promise((res) => {
    if (_linien.length) return res(_linien.shift());
    if (_eof) return res(null);
    _warte = res;
  });
}

// Dateinamen-Baustein aus dem Leistungsnamen (Umlaute -> ae/oe/ue/ss, nur a-z0-9)
function slug(s) {
  return String(s || 'bild').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'bild';
}
// Pfad-Eingabe robust machen (Anfuehrungszeichen/Leerzeichen/~ vom Kopieren/Drag&Drop)
function saeuberePfad(p) {
  p = String(p || '').trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) p = p.slice(1, -1);
  p = p.trim().replace(/\\ /g, ' ');
  if (p.startsWith('~/')) p = path.join(process.env.HOME || '/root', p.slice(2));
  return p;
}

const ZIELE = {
  buchung: {
    label: 'Buchungs-Leistungen (Assistent /termin/)',
    praefix: 'svc',
    statisch: false,
    lade: async () => (await query(
      "SELECT bl.id, COALESCE(bl.titel, a.name) AS name, bl.rolle, bl.bild_url " +
      "FROM buchung_leistungen bl JOIN artikel a ON a.id = bl.artikel_id " +
      "ORDER BY bl.rolle, bl.sortierung")).rows,
    setze: (id, url) => query('UPDATE buchung_leistungen SET bild_url=$1 WHERE id=$2', [url, id])
  },
  homepage: {
    label: 'Homepage-Kacheln "Unsere Leistungen"',
    praefix: 'leistung',
    statisch: true,
    lade: async () => (await query(
      "SELECT id, headline AS name, typ AS rolle, bild_url FROM homepage_sektionen " +
      "WHERE typ='leistung' ORDER BY sortierung")).rows,
    setze: (id, url) => query('UPDATE homepage_sektionen SET bild_url=$1, geaendert_am=NOW() WHERE id=$2', [url, id])
  }
};

async function main() {
  console.log('\n=== Leistungsbilder hochladen ===\n');
  console.log('  1) ' + ZIELE.buchung.label);
  console.log('  2) ' + ZIELE.homepage.label);
  const wahl = ((await frage('\nWelche Leistungen? [1/2] (Enter = 1): ')) || '').trim();
  const ziel = wahl === '2' ? ZIELE.homepage : ZIELE.buchung;

  const rows = await ziel.lade();
  if (!rows.length) { console.log('Keine Leistungen gefunden.'); return; }

  console.log('\n' + rows.length + ' Leistungen. Pro Leistung einen Bildpfad eingeben.');
  console.log('  Enter = ueberspringen (aktuelles Bild behalten)');
  console.log('  q     = beenden\n');

  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let geaendert = 0, uebersprungen = 0, abbruch = false;

  for (let i = 0; i < rows.length && !abbruch; i++) {
    const r = rows[i];
    console.log('----------------------------------------');
    console.log('[' + (i + 1) + '/' + rows.length + ']  ' + r.name + '  (' + r.rolle + ')');
    console.log('   aktuell: ' + (r.bild_url || 'kein Bild'));

    let erledigt = false;
    while (!erledigt) {
      const raw = await frage('   Neues Bild (Pfad): ');
      if (raw === null) { abbruch = true; erledigt = true; break; }
      const eingabe = saeuberePfad(raw);
      if (eingabe === '') { uebersprungen++; erledigt = true; break; }
      if (eingabe.toLowerCase() === 'q') { abbruch = true; erledigt = true; break; }
      if (!fs.existsSync(eingabe) || !fs.statSync(eingabe).isFile()) {
        console.log('   ! Datei nicht gefunden. Nochmal eingeben, oder Enter zum Ueberspringen.');
        continue;
      }
      try {
        const out = await verarbeite(fs.readFileSync(eingabe), 'inhalt');
        const name = ziel.praefix + '-' + slug(r.name) + '-' + Date.now() + '.jpg';
        fs.writeFileSync(path.join(UPLOAD_DIR, name), out);
        await ziel.setze(r.id, '/uploads/' + name);
        console.log('   OK  ->  /uploads/' + name + '   (900x675, ' + Math.round(out.length / 1024) + ' KB)');
        geaendert++; erledigt = true;
      } catch (e) {
        console.log('   ! Keine gueltige Bilddatei (' + e.message + '). Nochmal, oder Enter zum Ueberspringen.');
      }
    }
  }

  console.log('\n========================================');
  console.log('Fertig: ' + geaendert + ' geaendert, ' + uebersprungen + ' uebersprungen' + (abbruch ? ' (abgebrochen).' : '.'));
  if (geaendert > 0 && ziel.statisch) {
    process.stdout.write('Homepage wird neu generiert ... ');
    await require('../src/lib/homepage-generate').regenerate();
    console.log('ok.');
  } else if (geaendert > 0) {
    console.log('Die Buchungsseite /termin/ zeigt die neuen Bilder sofort (laedt live aus der DB).');
  }
}

main()
  .catch((e) => { console.error('\nFehler:', e.message); })
  .finally(async () => {
    rl.close();
    try { await pool.end(); } catch (e) { /* egal */ }
    process.exit(0);
  });
