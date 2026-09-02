// Besucherstatistik der Homepage — ohne Cookies, ohne Drittanbieter.
//
// Grundlage ist das eigene Zugriffsprotokoll von schroeder-scholz.de
// (/etc/nginx/conf.d/schroeder-statistik.conf). Dort wird die IP bereits BEIM SCHREIBEN
// gekuerzt (letztes Oktett auf 0), es liegt also gar keine vollstaendige IP-Adresse vor.
// Deshalb braucht diese Auswertung kein Einwilligungsbanner und es fliessen keine Daten
// an Dritte — anders als bei Google Analytics.
//
// Bewusst KEIN eigenes Zaehlpixel und kein JavaScript im Frontend: Der Webserver
// protokolliert ohnehin, das ist die datensparsamste Variante.
const express = require('express');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { query } = require('../db');
const { authenticate, requireStaff } = require('../middleware/auth');

const router = express.Router();

const LOG_DIR = '/var/log/nginx';
const LOG_BASIS = 'schroeder-scholz.access.log';

// IP ist bereits anonymisiert, Rest entspricht dem Standardformat.
const ZEILE = /^(\S+) - \[([^\]]+)\] "([A-Z]+) ([^" ]*)[^"]*" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"/;

const MONATE = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// "02/Sep/2026:15:38:24 +0200" -> "2026-09-02"
function tagAus(zeitstempel) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4})/.exec(zeitstempel);
  if (!m || MONATE[m[2]] === undefined) return null;
  return `${m[3]}-${String(MONATE[m[2]] + 1).padStart(2, '0')}-${m[1]}`;
}

// Alles, was kein Seitenaufruf eines Menschen ist, faellt raus: Schnittstellenaufrufe,
// Bilder, Stylesheets, Schriften. Sonst zaehlt jede Seite ein Dutzend Mal.
function istSeitenaufruf(pfad) {
  if (!pfad || pfad.startsWith('/api/')) return false;
  return !/\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|map|xml|txt|json|pdf)$/i.test(pfad.split('?')[0]);
}

// Grobe Erkennung automatisierter Zugriffe. Absichtlich streng: Lieber ein paar echte
// Besucher weniger als eine Statistik, die von Suchmaschinen-Robotern aufgeblaeht ist.
function istRoboter(ua) {
  return !ua || ua === '-' || /bot|crawl|spider|slurp|curl|wget|python|headless|monitor|uptime|preview|scanner|http-client|axios|node-fetch/i.test(ua);
}

function istHandy(ua) {
  return /Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua) && !/iPad|Tablet/i.test(ua);
}

// Woher kommt der Besucher? Der Flyer-QR fuehrt auf /termin/?code=..., das Banner der
// eigenen Website auf /termin/?gutschein=... — daran lassen sich beide sauber trennen.
function herkunft(pfad, referer) {
  const abfrage = pfad.split('?')[1] || '';
  if (/(^|&)code=/i.test(abfrage)) return 'Flyer (QR-Code)';
  if (/(^|&)gutschein=/i.test(abfrage)) return 'Banner auf der Website';
  if (!referer || referer === '-') return 'Direkt eingegeben';
  try {
    const host = new URL(referer).hostname.replace(/^www\./, '');
    if (/schroeder-scholz\.de$/i.test(host)) return null; // interner Klick, keine Herkunft
    if (/google|bing|duckduckgo|ecosia|yahoo|startpage|qwant/i.test(host)) return 'Suchmaschine';
    if (/facebook|instagram|tiktok|youtube|linkedin|x\.com|twitter/i.test(host)) return 'Soziale Netzwerke';
    return host;
  } catch (e) { return 'Unbekannte Quelle'; }
}

function seitenName(pfad) {
  const p = (pfad.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  const namen = {
    '/': 'Startseite', '/termin': 'Terminbuchung', '/preise': 'Preise',
    '/impressum': 'Impressum', '/portal': 'Kundenportal',
    '/portal/agb.html': 'AGB', '/portal/datenschutz.html': 'Datenschutz',
    '/portal/impressum.html': 'Impressum', '/portal/faq.html': 'Fragen und Antworten',
  };
  return namen[p] || p;
}

// Liest das aktuelle Protokoll plus die rotierten Dateien, soweit sie in den Zeitraum
// fallen. Gelesen wird zeilenweise ueber einen Puffer — die Dateien koennen gross werden.
function dateienLesen(tageZurueck) {
  const dateien = [];
  try {
    for (const name of fs.readdirSync(LOG_DIR)) {
      if (!name.startsWith(LOG_BASIS)) continue;
      const voll = path.join(LOG_DIR, name);
      const stat = fs.statSync(voll);
      const alterTage = (Date.now() - stat.mtimeMs) / 86400000;
      if (alterTage <= tageZurueck + 1) dateien.push(voll);
    }
  } catch (e) { return []; }
  return dateien.sort();
}

function zeilenAus(datei) {
  try {
    const roh = datei.endsWith('.gz')
      ? zlib.gunzipSync(fs.readFileSync(datei))
      : fs.readFileSync(datei);
    return roh.toString('utf8').split('\n');
  } catch (e) { return []; }
}

router.get('/', authenticate, requireStaff, async (req, res, next) => {
  try {
    const tage = Math.min(Math.max(parseInt(req.query.tage, 10) || 30, 1), 365);
    const grenze = new Date(Date.now() - tage * 86400000).toISOString().slice(0, 10);

    const proTag = new Map();
    const proSeite = new Map();
    const proHerkunft = new Map();
    let handy = 0, rechner = 0, roboterZeilen = 0, gesamt = 0, flyerScans = 0;

    for (const datei of dateienLesen(tage)) {
      for (const zeile of zeilenAus(datei)) {
        if (!zeile) continue;
        const m = ZEILE.exec(zeile);
        if (!m) continue;
        const [, , zeitstempel, methode, pfad, status, , referer, ua] = m;
        if (methode !== 'GET') continue;
        if (Number(status) >= 400) continue;
        if (!istSeitenaufruf(pfad)) continue;
        if (istRoboter(ua)) { roboterZeilen++; continue; }
        const tag = tagAus(zeitstempel);
        if (!tag || tag < grenze) continue;

        gesamt++;
        proTag.set(tag, (proTag.get(tag) || 0) + 1);
        const seite = seitenName(pfad);
        proSeite.set(seite, (proSeite.get(seite) || 0) + 1);
        const h = herkunft(pfad, referer);
        if (h) proHerkunft.set(h, (proHerkunft.get(h) || 0) + 1);
        if (h === 'Flyer (QR-Code)') flyerScans++;
        if (istHandy(ua)) handy++; else rechner++;
      }
    }

    // Aufrufe allein sagen nichts ueber Umsatz. Erst das Verhaeltnis zu den tatsaechlichen
    // Buchungen zeigt, ob die Seite ihren Zweck erfuellt.
    const buch = (await query(
      `SELECT count(*)::int AS gesamt,
              count(*) FILTER (WHERE gutschein_code IS NOT NULL)::int AS mit_gutschein
         FROM termine WHERE erstellt_am >= $1::date`, [grenze])).rows[0];

    const sortiert = (map, max) => [...map.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, max)
      .map(([name, anzahl]) => ({ name, anzahl }));

    // Luecken auffuellen, damit der Verlauf keine Tage ueberspringt.
    const verlauf = [];
    for (let i = tage - 1; i >= 0; i--) {
      const t = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      verlauf.push({ tag: t, anzahl: proTag.get(t) || 0 });
    }

    res.json({
      zeitraum_tage: tage,
      seitenaufrufe: gesamt,
      verlauf,
      top_seiten: sortiert(proSeite, 12),
      herkunft: sortiert(proHerkunft, 12),
      geraete: { handy, rechner },
      flyer_scans: flyerScans,
      buchungen: buch.gesamt,
      buchungen_mit_gutschein: buch.mit_gutschein,
      // Anteil der Besucher, die tatsaechlich einen Termin gebucht haben.
      buchungsquote: gesamt > 0 ? Math.round((buch.gesamt / gesamt) * 1000) / 10 : null,
      roboter_gefiltert: roboterZeilen,
      hinweis: 'Grundlage ist das Zugriffsprotokoll des Webservers. Die IP-Adresse wird '
        + 'bereits beim Schreiben gekürzt, es werden keine Cookies gesetzt und keine Daten '
        + 'an Dritte übertragen.',
    });
  } catch (err) { next(err); }
});

module.exports = router;
