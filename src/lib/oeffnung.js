'use strict';
// Lesemodell fuer Oeffnungszeiten: besondere Tage (Feiertag/Urlaub) ueberschreiben die regulaere Woche.
// Ersetzt die frueheren Einzelfeld-Abfragen (mo_fr_*, sa_*, so_*, mittagspause_*) in Homepage/Portal/Gast.
const { query, withTransaction } = require('../db/index');

// JS getDay(): So=0..Sa=6  ->  intern Mo=0..So=6
function internerWochentag(jsDay) { return (jsDay + 6) % 7; }

// 'YYYY-MM-DD' -> lokaler Wochentag (Zeitzonenbug vermeiden: T12:00:00 anhaengen)
function wochentagAusDatum(datumStr) {
  return internerWochentag(new Date(datumStr + 'T12:00:00').getDay());
}

// Liefert { geschlossen:boolean, spannen:[[von,bis],...] } fuer ein Datum 'YYYY-MM-DD'.
// von/bis sind 'HH:MM'-Strings (auf Minuten gekuerzt).
async function oeffnungFuerTag(datumStr) {
  const kurz = (t) => t ? String(t).slice(0, 5) : null;
  // 1. Besonderer Tag? (ueberschreibt die Woche)
  const bt = (await query('SELECT geschlossen, von, bis FROM besondere_tage WHERE datum=$1', [datumStr])).rows[0];
  if (bt) {
    if (bt.geschlossen) return { geschlossen: true, spannen: [] };
    if (bt.von && bt.bis) return { geschlossen: false, spannen: [[kurz(bt.von), kurz(bt.bis)]] };
    // nicht geschlossen, aber ohne eigene Zeiten -> regulaere Zeiten gelten (unten weiter)
  }
  // 2. Regulaerer Wochentag
  const wt = wochentagAusDatum(datumStr);
  const row = (await query('SELECT geschlossen, von1, bis1, von2, bis2 FROM oeffnungszeiten WHERE wochentag=$1', [wt])).rows[0];
  if (!row || row.geschlossen) return { geschlossen: true, spannen: [] };
  const spannen = [];
  if (row.von1 && row.bis1) spannen.push([kurz(row.von1), kurz(row.bis1)]);
  if (row.von2 && row.bis2) spannen.push([kurz(row.von2), kurz(row.bis2)]);
  return { geschlossen: spannen.length === 0, spannen };
}

// Ganze Woche (fuer Homepage-Anzeige/schema.org): Array[0..6] = { geschlossen, spannen }.
async function regulaereWoche() {
  const rows = (await query('SELECT wochentag, geschlossen, von1, bis1, von2, bis2 FROM oeffnungszeiten')).rows;
  const kurz = (t) => t ? String(t).slice(0, 5) : null;
  const woche = [];
  for (let wt = 0; wt < 7; wt++) {
    const row = rows.find((r) => r.wochentag === wt);
    if (!row || row.geschlossen) { woche.push({ geschlossen: true, spannen: [] }); continue; }
    const spannen = [];
    if (row.von1 && row.bis1) spannen.push([kurz(row.von1), kurz(row.bis1)]);
    if (row.von2 && row.bis2) spannen.push([kurz(row.von2), kurz(row.bis2)]);
    woche.push({ geschlossen: spannen.length === 0, spannen });
  }
  return woche;
}


// Kommende besondere Tage (Feiertag/Betriebsurlaub) fuer die Website-Anzeige und schema.org.
// Nur Tage mit echter Abweichung: geschlossen ODER eigene Zeiten. Tage ohne Abweichung
// (geschlossen=false, keine Zeiten) sagen dem Besucher nichts und bleiben aussen vor.
async function besondereTageAbHeute(tage) {
  const n = Math.max(1, Math.min(365, parseInt(tage, 10) || 60));
  const { rows } = await query(
    `SELECT to_char(datum,'YYYY-MM-DD') AS datum, bezeichnung, geschlossen,
            to_char(von,'HH24:MI') AS von, to_char(bis,'HH24:MI') AS bis
       FROM besondere_tage
      WHERE datum >= CURRENT_DATE AND datum <= CURRENT_DATE + ($1 || ' days')::interval
      ORDER BY datum`, [String(n)]);
  return rows.filter((r) => r.geschlossen || (r.von && r.bis));
}

// Wochenraster speichern (7 Tage, je bis zu 2 Spannen) + Alt-Felder synchron halten.
// Alt-Felder (mo_fr_*, sa_*, so_*, mittagspause_*) werden weiterhin von Portal-FAQ,
// Einlagerungs-Mails und dem Admin-Kalender gelesen -> muessen zum Raster passen.
// Zwilling dieser Sync-Logik: src/routes/einstellungen.js (PUT /oeffnungszeiten).
function normalisiereWoche(eingabe) {
  const zeit = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '').trim()) ? String(v).trim() : null);
  // Boolesche Werte koennen als String ankommen ('true' aus Formularen) -> sauber deuten
  const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
  const woche = [];
  for (let wt = 0; wt < 7; wt++) {
    const d = (Array.isArray(eingabe) ? eingabe : []).find((x) => parseInt(x && x.wochentag, 10) === wt) || {};
    if (bool(d.geschlossen)) { woche.push({ wochentag: wt, geschlossen: true, von1: null, bis1: null, von2: null, bis2: null }); continue; }
    let von1 = zeit(d.von1), bis1 = zeit(d.bis1), von2 = zeit(d.von2), bis2 = zeit(d.bis2);
    // Unvollstaendige oder verdrehte Spannen verwerfen statt kaputt zu speichern
    if (!von1 || !bis1 || von1 >= bis1) { von1 = null; bis1 = null; von2 = null; bis2 = null; }
    if (!von2 || !bis2 || von2 >= bis2 || (bis1 && von2 < bis1)) { von2 = null; bis2 = null; }
    // Luecklos aneinander (12:00–12:00) ist keine Pause -> zu einer Spanne zusammenziehen
    if (von2 && von2 === bis1) { bis1 = bis2; von2 = null; bis2 = null; }
    woche.push({ wochentag: wt, geschlossen: !von1, von1, bis1, von2, bis2 });
  }
  return woche;
}

// Eingabe pruefen, BEVOR gespeichert wird: fehlende Tage wuerden sonst stillschweigend
// auf „geschlossen“ fallen und damit auch die Online-Buchung abschalten.
// Rueckgabe: Fehlertext (String) oder null, wenn alles in Ordnung ist.
function pruefeWoche(eingabe) {
  if (!Array.isArray(eingabe)) return 'Öffnungszeiten müssen als Liste der sieben Wochentage übergeben werden.';
  const gesehen = new Set();
  for (const d of eingabe) {
    const wt = parseInt(d && d.wochentag, 10);
    if (!(wt >= 0 && wt <= 6)) return 'Ungültiger Wochentag in den Öffnungszeiten (erlaubt: 0 = Montag bis 6 = Sonntag).';
    if (gesehen.has(wt)) return 'Ein Wochentag wurde doppelt übergeben.';
    gesehen.add(wt);
  }
  if (gesehen.size !== 7) return 'Es müssen alle sieben Wochentage übergeben werden.';
  // Geoeffnete Tage brauchen eine gueltige Spanne; sonst waere der Tag ungewollt zu.
  const zeitOk = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '').trim());
  const leer = (v) => String(v == null ? '' : v).trim() === '';
  const NAME = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  for (const d of eingabe) {
    const wt = parseInt(d.wochentag, 10);
    if (d.geschlossen === true || d.geschlossen === 'true') continue;
    if (!zeitOk(d.von1) || !zeitOk(d.bis1)) return NAME[wt] + ': Bitte gültige Uhrzeiten (Format 08:00) eintragen oder den Tag auf geschlossen stellen.';
    if (String(d.von1).trim() >= String(d.bis1).trim()) return NAME[wt] + ': Die Uhrzeit „von“ muss vor „bis“ liegen.';
    if (leer(d.von2) && leer(d.bis2)) continue;
    if (!zeitOk(d.von2) || !zeitOk(d.bis2)) return NAME[wt] + ': Bitte für die Mittagspause gültige Uhrzeiten eintragen oder das Häkchen entfernen.';
    if (String(d.von2).trim() >= String(d.bis2).trim()) return NAME[wt] + ': Die zweite Spanne muss vor ihrem Ende beginnen.';
    if (String(d.von2).trim() < String(d.bis1).trim()) return NAME[wt] + ': Die zweite Spanne darf nicht vor dem Ende der ersten beginnen.';
  }
  return null;
}

async function wocheSpeichern(eingabe) {
  const woche = normalisiereWoche(eingabe);
  const mo = woche[0], sa = woche[5], so = woche[6];
  const pause = (d) => d && !d.geschlossen && d.von2 && d.bis2;
  // Hinweis: Die Alt-Felder kennen nur EINEN Mo–Fr-Block; abweichende Zeiten an einzelnen
  // Werktagen bilden sie nicht ab (Montag ist der Stellvertreter). Sie sind Uebergang —
  // Portal/E-Mails sollten mittelfristig auf regulaereWoche()/oeffnungFuerTag() umstellen.
  const sync = {
    mo_fr_von: mo.geschlossen ? null : mo.von1,
    mo_fr_bis: mo.geschlossen ? null : (pause(mo) ? mo.bis2 : mo.bis1),
    mittagspause_von: pause(mo) ? mo.bis1 : null,
    mittagspause_bis: pause(mo) ? mo.von2 : null,
    sa_offen: !sa.geschlossen,
    sa_von: sa.geschlossen ? null : sa.von1,
    sa_bis: sa.geschlossen ? null : (pause(sa) ? sa.bis2 : sa.bis1),
    so_offen: !so.geschlossen,
    so_von: so.geschlossen ? null : so.von1,
    so_bis: so.geschlossen ? null : (pause(so) ? so.bis2 : so.bis1)
  };
  const cols = Object.keys(sync);
  // Alles in EINER Transaktion: sonst koennte eine halb geschriebene Woche entstehen oder
  // das Raster nicht mehr zu den Alt-Feldern passen (Buchung vs. Anzeige).
  await withTransaction(async (client) => {
    for (const d of woche) {
      await client.query(
        `INSERT INTO oeffnungszeiten (wochentag, geschlossen, von1, bis1, von2, bis2)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (wochentag) DO UPDATE SET geschlossen=$2, von1=$3, bis1=$4, von2=$5, bis2=$6`,
        [d.wochentag, d.geschlossen, d.von1, d.bis1, d.von2, d.bis2]);
    }
    await client.query(
      'UPDATE einstellungen SET ' + cols.map((c, i) => c + '=$' + (i + 1)).join(', ') +
      ', geaendert_am=NOW() WHERE id=(SELECT id FROM einstellungen ORDER BY id LIMIT 1)',
      cols.map((c) => sync[c]));
  });
  return woche;
}

module.exports = { oeffnungFuerTag, regulaereWoche, wochentagAusDatum, internerWochentag, besondereTageAbHeute, normalisiereWoche, pruefeWoche, wocheSpeichern };
