'use strict';
// Rendert die Homepage als statisches HTML aus den DB-Sektionen + Firmendaten.
// Liegt auf dem Server unter src/lib/homepage-render.js

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function absUrl(u) { u = String(u || ''); return u.charAt(0) === '/' ? 'https://www.schroeder-scholz.de' + u : u; }
function hm(t) { return t ? String(t).substring(0, 5) : ''; }
function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
// Sicheres Rich-Text-Rendering: alles escapen, dann nur erlaubte Tags wiederherstellen.
// Nicht erlaubte Tags/Attribute bleiben escaped -> kein XSS moeglich (script/onclick etc. unmoeglich).
function richHtml(s) {
  if (s == null) return '';
  var str = String(s);
  if (!/<\/?(b|strong|i|em|u|a|ul|ol|li|p|br)\b/i.test(str)) return esc(str).replace(/\n/g, '<br>');
  var e = esc(str);
  e = e.replace(/&lt;(\/?)(b|strong|i|em|u|ul|ol|li|p)&gt;/gi, '<$1$2>');
  e = e.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  e = e.replace(/&lt;a\s+href=&quot;([\s\S]*?)&quot;&gt;/gi, function (m, url) {
    url = url.replace(/&amp;/g, '&').trim();
    if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url)) return '';
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener">';
  });
  e = e.replace(/&lt;\/a&gt;/gi, '</a>');
  return e;
}
function sterneHtml(n) {
  n = Math.max(0, Math.min(5, parseInt(n) || 0));
  var s = '';
  for (var i = 0; i < 5; i++) s += '<span class="star' + (i < n ? ' on' : '') + '">&#9733;</span>';
  return '<span class="stars">' + s + '</span>';
}
function renderFaq(s) {
  var items = (s.daten && Array.isArray(s.daten.items) ? s.daten.items : []).filter(function (i) { return i && i.frage; });
  if (!items.length) return '';
  var body = items.map(function (i) {
    return '<details class="faq-i"><summary>' + esc(i.frage) + '</summary><div class="faq-a">' + richHtml(i.antwort || '') + '</div></details>';
  }).join('');
  return '<section class="sec alt" id="faq" data-sektion-id="' + esc(s.id) + '"><div class="inner narrow">' +
    '<h2>' + esc(s.headline || 'Häufige Fragen') + '</h2>' + body + '</div></section>';
}
function renderKundenstimmen(s) {
  var items = (s.daten && Array.isArray(s.daten.items) ? s.daten.items : []).filter(function (i) { return i && i.text; });
  if (!items.length) return '';
  var cards = items.map(function (i) {
    return '<figure class="ks-card">' + sterneHtml(i.sterne) +
      '<blockquote>' + esc(i.text) + '</blockquote>' +
      (i.name ? '<figcaption>— ' + esc(i.name) + '</figcaption>' : '') + '</figure>';
  }).join('');
  var cta = s.daten && s.daten.google_url ? '<div style="text-align:center;margin-top:24px"><a class="btn" href="' + esc(s.daten.google_url) + '" target="_blank" rel="noopener">Bei Google bewerten</a></div>' : '';
  return '<section class="sec" id="kundenstimmen" data-sektion-id="' + esc(s.id) + '"><div class="inner">' +
    '<h2>' + esc(s.headline || 'Das sagen unsere Kunden') + '</h2><div class="ks-grid">' + cards + '</div>' + cta + '</div></section>';
}
function renderGalerie(s) {
  var bilder = (s.daten && Array.isArray(s.daten.bilder) ? s.daten.bilder : []).filter(Boolean);
  if (!bilder.length) return '';
  var imgs = bilder.map(function (u, idx) {
    return '<img src="' + esc(u) + '" alt="' + esc((s.headline || 'Galerie') + ' ' + (idx + 1)) + '" loading="lazy" width="600" height="450">';
  }).join('');
  return '<section class="sec" id="galerie" data-sektion-id="' + esc(s.id) + '"><div class="inner">' +
    '<h2>' + esc(s.headline || 'Galerie') + '</h2><div class="gal-grid">' + imgs + '</div></div></section>';
}

// ── Öffnungszeiten ──────────────────────────────────────────────────────────
// Quelle ist das Wochenraster (Tabelle `oeffnungszeiten`, Mo=0..So=6) inkl. zweiter
// Spanne (Mittagspause) und geschlossener Tage. Fehlt es (alter Datenstand), greifen
// die Alt-Felder mo_fr_*/sa_*/so_* als Rückfallebene.
var TAG_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
var TAG_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

function spannenText(spannen) {
  return (spannen || []).map(function (sp) { return hm(sp[0]) + ' – ' + hm(sp[1]); }).join(' und ');
}

// Gleiche aufeinanderfolgende Tage zusammenfassen: „Mo – Fr  08:00 – 18:00“.
function oeffnungszeilenAusWoche(woche) {
  var z = [];
  var i = 0;
  while (i < 7) {
    var tag = woche[i] || { geschlossen: true, spannen: [] };
    var text = tag.geschlossen || !(tag.spannen || []).length ? 'geschlossen' : spannenText(tag.spannen);
    var j = i;
    while (j + 1 < 7) {
      var nx = woche[j + 1] || { geschlossen: true, spannen: [] };
      var ntext = nx.geschlossen || !(nx.spannen || []).length ? 'geschlossen' : spannenText(nx.spannen);
      if (ntext !== text) break;
      j++;
    }
    var label = i === j ? TAG_LANG[i] : TAG_KURZ[i] + ' – ' + TAG_KURZ[j];
    z.push([label, text]);
    i = j + 1;
  }
  // Eine Woche komplett ohne Zeiten -> lieber gar keine Tabelle als sieben Mal „geschlossen“
  if (z.every(function (r) { return r[1] === 'geschlossen'; })) return [];
  return z;
}

function oeffnungszeilen(f, oz) {
  if (oz && Array.isArray(oz.woche) && oz.woche.length === 7) return oeffnungszeilenAusWoche(oz.woche);
  var z = [];
  if (f.mo_fr_von && f.mo_fr_bis) z.push(['Mo – Fr', hm(f.mo_fr_von) + ' – ' + hm(f.mo_fr_bis)]);
  if (f.sa_offen && f.sa_von && f.sa_bis) z.push(['Samstag', hm(f.sa_von) + ' – ' + hm(f.sa_bis)]);
  if (f.so_offen && f.so_von && f.so_bis) z.push(['Sonntag', hm(f.so_von) + ' – ' + hm(f.so_bis)]);
  return z;
}

// „Do, 03.10.2026 — Tag der Deutschen Einheit: geschlossen“
function besondererTagText(b) {
  var d = new Date(b.datum + 'T12:00:00');
  var datum = TAG_KURZ[(d.getDay() + 6) % 7] + ', ' + ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
  var zeit = b.geschlossen ? 'geschlossen' : hm(b.von) + ' – ' + hm(b.bis);
  return [datum + (b.bezeichnung ? ' – ' + b.bezeichnung : ''), zeit];
}

// Hinweisblock unter der Tabelle: Feiertage/Betriebsurlaub + freier Hinweistext.
function besondereTageHtml(oz) {
  var liste = (oz && Array.isArray(oz.besondere) ? oz.besondere : []).slice(0, 8);
  if (!liste.length) return '';
  var zeilen = liste.map(function (b) {
    var t = besondererTagText(b);
    return '<tr><td>' + esc(t[0]) + '</td><td>' + esc(t[1]) + '</td></tr>';
  }).join('');
  return '<div class="oz-bes"><h3>Feiertage &amp; besondere Tage</h3><table class="oz">' + zeilen + '</table></div>';
}

function jsonLd(f, oz) {
  var data = {
    '@context': 'https://schema.org', '@type': 'AutoRepair',
    name: 'Schröder & Scholz',
    description: 'Reifenservice: Räderwechsel, Reifeneinlagerung sowie Reifen & Felgen.',
    url: 'https://www.schroeder-scholz.de/',
    image: 'https://www.schroeder-scholz.de/uploads/hero.jpg'
  };
  if (f.telefon) data.telephone = f.telefon;
  if (f.email) data.email = f.email;
  data.priceRange = '€€';
  if (f.ort) data.areaServed = f.ort;
  if (f.strasse || f.ort) data.address = { '@type': 'PostalAddress', streetAddress: f.strasse || '', postalCode: f.plz || '', addressLocality: f.ort || '', addressCountry: 'DE' };
  if (f.geo_breite && f.geo_laenge) data.geo = { '@type': 'GeoCoordinates', latitude: f.geo_breite, longitude: f.geo_laenge };
  var social = [f.google_bewertung_url, f.facebook_url, f.instagram_url].filter(Boolean);
  if (social.length) data.sameAs = social;
  var oh = [];
  var SCHEMA_TAG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  if (oz && Array.isArray(oz.woche) && oz.woche.length === 7) {
    // Je Spanne ein Eintrag (Mittagspause = zwei Eintraege), geschlossene Tage weglassen.
    for (var wt = 0; wt < 7; wt++) {
      var tag = oz.woche[wt];
      if (!tag || tag.geschlossen) continue;
      (tag.spannen || []).forEach(function (sp) {
        oh.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: SCHEMA_TAG[wt], opens: hm(sp[0]), closes: hm(sp[1]) });
      });
    }
  } else {
    if (f.mo_fr_von && f.mo_fr_bis) oh.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: hm(f.mo_fr_von), closes: hm(f.mo_fr_bis) });
    if (f.sa_offen && f.sa_von && f.sa_bis) oh.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: 'Saturday', opens: hm(f.sa_von), closes: hm(f.sa_bis) });
    if (f.so_offen && f.so_von && f.so_bis) oh.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: 'Sunday', opens: hm(f.so_von), closes: hm(f.so_bis) });
  }
  if (oh.length) data.openingHoursSpecification = oh;
  // Feiertage/Betriebsurlaub als Sonderzeiten -> Google zeigt „an Feiertagen geschlossen“
  var bes = (oz && Array.isArray(oz.besondere) ? oz.besondere : []).map(function (b) {
    return {
      '@type': 'OpeningHoursSpecification',
      validFrom: b.datum, validThrough: b.datum,
      opens: b.geschlossen ? '00:00' : hm(b.von),
      closes: b.geschlossen ? '00:00' : hm(b.bis)
    };
  });
  if (bes.length) data.specialOpeningHoursSpecification = bes;
  return JSON.stringify(data);
}

// Social-Icons + Google-Bewerten im Footer (nur was in den Einstellungen hinterlegt ist)
function socialHtml(f) {
  var ICON_FB = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.25-1.5 1.5-1.5h1.7V4.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.2V14h2.8v8h3.5z"/></svg>';
  var ICON_IG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>';
  var ICON_GG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M21.6 12.2c0-.7-.06-1.2-.18-1.8H12v3.3h5.4c-.1.9-.7 2.2-2 3.1l-.02.12 2.9 2.2.2.02c1.85-1.7 2.92-4.2 2.92-7.16z"/><path d="M12 22c2.6 0 4.8-.86 6.4-2.34l-3.05-2.36c-.82.57-1.9.97-3.35.97-2.56 0-4.73-1.7-5.5-4.05l-.11.01-3 2.32-.04.11C4.95 19.6 8.2 22 12 22z"/><path d="M6.5 12.2c0-.4.07-.8.18-1.18l-.005-.13-3.04-2.36-.1.05C2.96 9.6 2.6 10.76 2.6 12s.36 2.4.94 3.4l3.14-2.43c-.11-.38-.18-.78-.18-1.18z"/><path d="M12 5.4c1.8 0 3.02.78 3.72 1.43l2.72-2.65C16.8 2.6 14.6 1.8 12 1.8 8.2 1.8 4.95 4.2 3.54 7.6l3.14 2.43C7.27 7.1 9.44 5.4 12 5.4z"/></svg>';
  var items = [];
  if (f.facebook_url) items.push('<a href="' + esc(f.facebook_url) + '" target="_blank" rel="noopener" aria-label="Facebook">' + ICON_FB + '</a>');
  if (f.instagram_url) items.push('<a href="' + esc(f.instagram_url) + '" target="_blank" rel="noopener" aria-label="Instagram">' + ICON_IG + '</a>');
  if (f.google_bewertung_url) items.push('<a href="' + esc(f.google_bewertung_url) + '" target="_blank" rel="noopener" aria-label="Google">' + ICON_GG + '</a>');
  if (!items.length) return '';
  var bew = f.google_bewertung_url ? '<a class="foot-bewerten" href="' + esc(f.google_bewertung_url) + '" target="_blank" rel="noopener">Bewerte uns bei Google</a>' : '';
  return '<div class="foot-social">' + items.join('') + '</div>' + bew;
}

// Wortmarke exakt wie im Kundenportal (heller Text fuer dunklen Hintergrund).
function logoSvg(w, h) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 100" width="' + w + '" height="' + h + '" style="display:block">' +
    '<text x="0" y="52" font-family="-apple-system,\'Helvetica Neue\',Arial,sans-serif" font-size="42" font-weight="800" letter-spacing="-1.5" fill="#fafafa">SCHRÖDER <tspan fill="#eab308">&amp;</tspan> SCHOLZ</text>' +
    '<rect x="2" y="68" width="46" height="5" fill="#eab308"/>' +
    '<text x="58" y="74" font-family="-apple-system,\'Helvetica Neue\',Arial,sans-serif" font-size="12" font-weight="600" letter-spacing="3.5" fill="#a3a3a3">REIFENSERVICE UND FAHRZEUGTECHNIK</text></svg>';
}

// Aktionsbanner (Gutschein/Werbung) – aus den Einstellungen.
function bannerHtml(f) {
  if (!f.aktion_aktiv || !f.aktion_text) return '';
  var pos = f.aktion_position || 'leiste';
  var code = f.aktion_code ? '<span class="akt-code">' + esc(f.aktion_code) + '</span>' : '';
  var link = f.aktion_link || '/termin/';
  // Gutscheincode an die Buchung mitgeben -> im Assistenten automatisch vorausgewaehlt
  if (f.aktion_code) link += (link.indexOf('?') === -1 ? '?' : '&') + 'gutschein=' + encodeURIComponent(f.aktion_code);
  var cta = '<a class="akt-cta" href="' + esc(link) + '">Jetzt Termin buchen</a>';
  var inner = '<span class="akt-text">' + esc(f.aktion_text) + '</span>' + code + cta;
  if (pos === 'leiste') return '<div class="akt-leiste">' + inner + '</div>';
  var seite = pos === 'ecke-links' ? ' links' : ' rechts';
  return '<div class="akt-ecke' + seite + '"><button class="akt-x" onclick="this.parentNode.remove()" aria-label="schließen">&times;</button>' + inner + '</div>';
}

// CTA-Abschnitt, der zur mehrstufigen Buchungsseite /termin/ fuehrt
function buchungHtml(f) {
  var titel = f.buchung_titel || 'Online Termin buchen';
  var text = f.buchung_text || 'In wenigen Schritten zum Wunschtermin: Leistung wählen, Zusatzleistungen ergänzen, freie Zeit aussuchen – du bekommst sofort eine Bestätigung per E-Mail.';
  return '<section class="sec buchung" id="termin-buchen"><div class="inner" style="text-align:center">' +
    '<h2 style="color:#fff">' + esc(titel) + '</h2>' +
    '<p class="bk-intro" style="margin:0 auto 24px">' + esc(text) + '</p>' +
    '<a class="btn" href="/termin/">Jetzt Termin buchen</a>' +
    '</div></section>';
}

function renderLeistungen(group) {
  var cards = group.map(function(s, i) {
    var nr = String(i + 1).padStart(2, '0');
    var img = s.bild_url ? '<div class="card-img"><img src="' + esc(s.bild_url) + '" alt="' + esc(s.bild_alt || s.headline || '') + '" width="900" height="675" loading="lazy"></div>' : '';
    // Klick auf eine Leistung -> Buchung; verknuepfte Hauptleistung wird vorausgewaehlt
    var href = '/termin/' + (s.buchung_artikel_id ? '?leistung=' + encodeURIComponent(s.buchung_artikel_id) : '');
    return '<a class="card-link" href="' + href + '" style="display:block;text-decoration:none;color:inherit">' +
      '<div class="card" data-sektion-id="' + esc(s.id) + '">' + img +
      '<div class="card-body">' +
      '<div class="card-icon">' + iconFor(s.headline) + '</div>' +
      '<div class="card-nr">' + nr + '</div>' +
      '<h3>' + esc(s.headline || '') + '</h3>' +
      '<div class="rt">' + richHtml(s.inhalt || '') + '</div>' +
      '<div class="card-cta">Termin buchen →</div>' +
      '</div></div></a>';
  }).join('');
  return '<section class="sec" id="leistungen"><div class="inner">' +
    '<h2>Unsere Leistungen</h2><div class="cards">' + cards + '</div></div></section>';
}

// ── Icons (schlichte Linien-SVGs, erben Farbe via currentColor) ──
var ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
var ICON_BOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>';
var ICON_EURO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6.5A7 7 0 1017 18M4 10.5h10M4 13.5h10"/></svg>';
var ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>';
var ICON_WHEEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/></svg>';
var ICON_DISC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>';
var ICON_SUSP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v4M7 17v4M4 8l3-1 3 1M4 16l3 1 3-1M7 7v10M17 3v4M17 17v4M14 8l3-1 3 1M14 16l3 1 3-1M17 7v10"/></svg>';
var ICON_WRENCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5a4 4 0 00-5 5L4 16l4 4 6-6a4 4 0 005-5l-3 3-2-2 2-3z"/></svg>';
function iconFor(h) {
  h = String(h || '').toLowerCase();
  if (/brems/.test(h)) return ICON_DISC;
  if (/fahrwerk|achs|spur/.test(h)) return ICON_SUSP;
  if (/einlager|lager/.test(h)) return ICON_BOX;
  if (/rad|reifen|räder|felge|wucht/.test(h)) return ICON_WHEEL;
  return ICON_WRENCH;
}

// Vollflaechiges Vorteile-/Vertrauens-Band (Icons) — wie bei den grossen Ketten
function renderVorteile() {
  var items = [
    [ICON_CLOCK, 'Schneller Räderwechsel', 'Kurze Wartezeit, sauber ausgeführt.'],
    [ICON_BOX, 'Sichere Reifeneinlagerung', 'Trocken & fachgerecht gelagert.'],
    [ICON_EURO, 'Faire, klare Preise', 'Online einsehbar, inkl. MwSt.'],
    [ICON_CAL, 'Termin in 2 Minuten', 'Jederzeit online buchbar.']
  ];
  return '<section class="vorteile"><div class="inner"><div class="vgrid">' +
    items.map(function (it) { return '<div class="vitem"><div class="vicon">' + it[0] + '</div><div><h4>' + it[1] + '</h4><p>' + it[2] + '</p></div></div>'; }).join('') +
    '</div></div></section>';
}

// Vollflaechiges Marken-Band (montieren alle Fabrikate) — Vertrauens-Element
function renderMarken() {
  var marken = ['Continental', 'Michelin', 'Goodyear', 'Bridgestone', 'Pirelli', 'Dunlop', 'Hankook', 'Vredestein'];
  return '<section class="marken"><div class="inner"><div class="mk-t">Wir montieren alle gängigen Reifenmarken</div>' +
    '<div class="mk-list">' + marken.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div></div></section>';
}

// Zusatz-CSS fuer die neuen Baender + Kachel-Icons (nutzt die :root-Tokens aus css())
function extraCss() {
  return '.vorteile{background:#f6f7f9;border-top:1px solid #e6e8ec;border-bottom:1px solid #e6e8ec}' +
    '.vorteile .inner{padding-top:34px;padding-bottom:34px}' +
    '.vgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:22px}' +
    '.vitem{display:flex;gap:14px;align-items:flex-start}' +
    '.vicon{flex:none;width:46px;height:46px;border-radius:12px;background:var(--accent);color:var(--accent-ink);display:flex;align-items:center;justify-content:center}' +
    '.vicon svg{width:24px;height:24px}' +
    '.vitem h4{font-size:calc(16px*var(--sc));margin:0 0 3px;color:#171717}' +
    '.vitem p{font-size:calc(13.5px*var(--sc));color:#666;margin:0;line-height:1.5}' +
    '.marken{background:var(--dark);color:#cfcfcf}' +
    '.marken .inner{padding-top:30px;padding-bottom:30px;text-align:center}' +
    '.marken .mk-t{font-size:calc(13px*var(--sc));text-transform:uppercase;letter-spacing:2px;color:#9aa0a6;margin-bottom:16px}' +
    '.mk-list{display:flex;flex-wrap:wrap;gap:14px 26px;justify-content:center;align-items:center}' +
    '.mk-list span{font-weight:800;font-size:calc(17px*var(--sc));color:#e6e6e6;letter-spacing:.5px;opacity:.9}' +
    '.card-icon{color:var(--accent);margin-bottom:10px}.card-icon svg{width:34px;height:34px;display:block}' +
    '@media(max-width:600px){.vgrid{gap:16px}}';
}

function renderSektion(s, f, oz) {
  if (s.typ === 'faq') return renderFaq(s);
  if (s.typ === 'kundenstimmen') return renderKundenstimmen(s);
  if (s.typ === 'galerie') return renderGalerie(s);
  if (s.typ === 'hero') {
    var bg = s.bild_url ? "linear-gradient(rgba(13,17,23,.55),rgba(13,17,23,.8)), url('" + esc(s.bild_url) + "')" : 'linear-gradient(135deg,#171717,#0d1117)';
    return '<section class="hero" data-sektion-id="' + esc(s.id) + '" style="background-image:' + bg + '">' +
      '<div class="hero-in">' +
      '<h1>' + esc(s.headline || '') + '</h1>' +
      (s.subline ? '<p>' + esc(s.subline) + '</p>' : '') +
      (s.cta_text ? '<a class="btn" href="' + esc(s.cta_url || '/portal/') + '">' + esc(s.cta_text) + '</a>' : '') +
      '</div></section>';
  }
  if (s.typ === 'oeffnungszeiten') {
    var rows = oeffnungszeilen(f, oz).map(function(r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') || '<tr><td colspan="2">Bitte frag unsere Öffnungszeiten kurz nach.</td></tr>';
    // Freier Hinweis (z. B. „Termine auch nach Vereinbarung“) aus den Firmendaten
    var hinweis = f.oeffnungszeiten_hinweis && String(f.oeffnungszeiten_hinweis).trim()
      ? '<p class="oz-hinweis">' + nl2br(String(f.oeffnungszeiten_hinweis).trim()) + '</p>' : '';
    return '<section class="sec alt" id="oeffnungszeiten"><div class="inner narrow"><h2>' + esc(s.headline || 'Öffnungszeiten') + '</h2>' +
      '<table class="oz">' + rows + '</table>' + hinweis + besondereTageHtml(oz) + '</div></section>';
  }
  if (s.typ === 'kontakt') {
    var hasAdr = !!(f.strasse || f.ort);
    var q = [f.firmenname, f.strasse, f.plz, f.ort].filter(Boolean).join(' ');
    var adr = [f.strasse, ((f.plz || '') + ' ' + (f.ort || '')).trim()].filter(Boolean).map(esc).join('<br>');
    var mapsLink = hasAdr ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
    var embed = hasAdr ? 'https://www.google.com/maps?q=' + encodeURIComponent(q) + '&output=embed' : '';
    var info = '<div class="k-card">' +
      '<h3>' + esc(f.firmenname || 'Schröder & Scholz') + '</h3>' +
      '<p>' + (adr || '<span style="color:#8b949e">Adresse folgt in Kürze.</span>') + '</p>' +
      (f.telefon ? '<p>Telefon: <a href="tel:' + esc(telZiel(f.telefon)) + '">' + esc(f.telefon) + '</a></p>' : '') +
      (f.email ? '<p>E-Mail: <a href="mailto:' + esc(f.email) + '">' + esc(f.email) + '</a></p>' : '') +
      (mapsLink ? '<p style="margin-top:14px"><a class="btn-ghost" href="' + mapsLink + '" target="_blank" rel="noopener">Route planen</a></p>' : '') +
      '</div>';
    var map = embed ? '<div class="k-map" id="kmap" data-embed="' + esc(embed) + '">' +
      '<div class="k-map-ph"><p>Standort auf der Karte</p>' +
      '<button type="button" class="btn-ghost" onclick="ladeKarte()">Karte anzeigen</button>' +
      '<span class="k-map-note">Beim Anzeigen werden Daten an Google Maps übertragen. Details in der <a href="/portal/datenschutz.html">Datenschutzerklärung</a>.</span>' +
      '</div></div>' : '';
    var form = '<form class="k-form" onsubmit="return sendeKontakt(event)">' +
      '<h3>Nachricht senden</h3>' +
      '<div class="kf-ok" id="kf-ok">Vielen Dank! Deine Anfrage ist angekommen. Wir melden uns zeitnah.</div>' +
      '<div class="kf-err" id="kf-err"></div>' +
      '<input type="text" id="kf-name" placeholder="Name" required>' +
      '<input type="email" id="kf-email" placeholder="E-Mail" required>' +
      '<input type="tel" id="kf-telefon" placeholder="Telefon (optional)">' +
      '<textarea id="kf-nachricht" placeholder="Deine Nachricht" required></textarea>' +
      '<label class="kf-check"><input type="checkbox" id="kf-dsgvo" required> <span>Ich habe die <a href="/portal/datenschutz.html" target="_blank" rel="noopener">Datenschutzerklärung</a> gelesen und bin mit der Verarbeitung meiner Angaben zur Bearbeitung der Anfrage einverstanden.</span></label>' +
      '<input type="text" id="kf-hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">' +
      '<button type="submit" class="btn">Anfrage senden</button>' +
      '</form>';
    return '<section class="sec" id="kontakt"><div class="inner"><h2>' + esc(s.headline || 'Kontakt & Anfahrt') + '</h2>' +
      '<div class="k-grid"><div class="k-left">' + info + map + '</div>' + form + '</div></div></section>';
  }
  // text
  var img = s.bild_url ? '<div class="t-img"><img src="' + esc(s.bild_url) + '" alt="' + esc(s.bild_alt || s.headline || '') + '" width="900" height="675" loading="lazy"></div>' : '';
  return '<section class="sec" data-sektion-id="' + esc(s.id) + '"><div class="inner t-grid">' +
    '<div class="t-text"><h2>' + esc(s.headline || '') + '</h2><div class="rt">' + richHtml(s.inhalt || '') + '</div></div>' + img +
    '</div></section>';
}

// Standard-Navigation (Fallback, wenn im CMS nichts hinterlegt ist)
var DEFAULT_NAV = [
  { label: 'Leistungen', url: '#leistungen', sichtbar: true, btn: false },
  { label: 'Preise', url: '/preise/', sichtbar: true, btn: false },
  { label: 'Termin buchen', url: '/termin/', sichtbar: true, btn: false },
  { label: 'Öffnungszeiten', url: '#oeffnungszeiten', sichtbar: true, btn: false },
  { label: 'Kontakt', url: '#kontakt', sichtbar: true, btn: false },
  { label: 'Kundenportal', url: '/portal/', sichtbar: true, btn: true }
];
// Aufklapp-Knopf fuers Handy. Auf schmalen Bildschirmen klappte die Navigation bisher
// ersatzlos weg — bei ueber 6000 Pixeln Seitenhoehe hiess das: alles nur per Scrollen.
var ICON_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
var ICON_ZU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
function menueKnopfHtml() {
  return '<button class="nav-burger" type="button" aria-label="Menü öffnen" aria-expanded="false" aria-controls="hauptmenue" onclick="menueUmschalten(this)">' +
    '<span class="b-auf">' + ICON_MENU + '</span><span class="b-zu">' + ICON_ZU + '</span></button>';
}

function navHtml(f) {
  var items = (f && Array.isArray(f.nav_links) && f.nav_links.length) ? f.nav_links : DEFAULT_NAV;
  return '<nav class="nav-links" id="hauptmenue">' + items
    .filter(function (i) { return i && i.sichtbar !== false && i.label; })
    .map(function (i) { return '<a' + (i.btn ? ' class="btn-sm"' : '') + ' href="' + esc(i.url || '#') + '">' + esc(i.label) + '</a>'; })
    .join('') + '</nav>';
}

// Telefon in der Kopfzeile — staerkster Hebel auf dem Handy (Anruf mit einem Tipp).
// Bleibt auf schmalen Bildschirmen sichtbar, waehrend die uebrigen Menuepunkte einklappen.
var ICON_TEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 006.5 6.5l1.5-2 4 1.5v3a2 2 0 01-2.2 2A17 17 0 014.5 5.2 2 2 0 016.5 3z"/></svg>';
// Waehlbares tel:-Ziel: Leer- und Trennzeichen raus, sonst scheitern manche Wähl-Apps.
// Die Anzeige bleibt immer die gepflegte Schreibweise aus den Firmendaten.
function telZiel(nr) { return String(nr || '').replace(/[^\d+]/g, ''); }
function telHtml(f) {
  if (!f.telefon) return '';
  var ziel = telZiel(f.telefon);
  if (!ziel) return '';
  return '<a class="nav-tel" href="tel:' + esc(ziel) + '" aria-label="Anrufen: ' + esc(f.telefon) + '">' +
    ICON_TEL + '<span class="tel-nr">' + esc(f.telefon) + '</span></a>';
}

function renderHomepage(sektionen, f, fonts, oz) {
  f = f || {};
  oz = oz || {};
  var aktiv = (sektionen || []).filter(function(s) { return s.sichtbar; }).sort(function(a, b) { return a.sortierung - b.sortierung; });
  var body = '';
  var i = 0;
  while (i < aktiv.length) {
    if (aktiv[i].typ === 'leistung') {
      var group = [];
      while (i < aktiv.length && aktiv[i].typ === 'leistung') { group.push(aktiv[i]); i++; }
      body += renderLeistungen(group);
    } else { body += renderSektion(aktiv[i], f, oz); i++; }
  }
  // Vorteile-Band direkt nach dem Hero, Marken-Band am Ende der Inhalte
  if (aktiv[0] && aktiv[0].typ === 'hero') body = body.replace('</section>', '</section>' + renderVorteile());
  else body = renderVorteile() + body;
  body += renderMarken();
  // Online-Terminbuchung fuer Gaeste (standardmaessig an, im CMS steuerbar)
  if (f.buchung_aktiv !== false) {
    var bh = buchungHtml(f);
    if (body.indexOf('<section class="sec" id="kontakt">') !== -1) body = body.replace('<section class="sec" id="kontakt">', bh + '<section class="sec" id="kontakt">');
    else body += bh;
  }
  var ort = f.ort ? ' in ' + f.ort : '';
  var seo = f.seo_config && typeof f.seo_config === 'object' ? f.seo_config : {};
  var title = (seo.titel && String(seo.titel).trim()) || ('Schröder & Scholz – Reifenservice, Räderwechsel & Reifeneinlagerung' + ort);
  var desc = (seo.beschreibung && String(seo.beschreibung).trim()) || ('Schröder & Scholz – dein Reifenservice' + ort + ': schneller Räderwechsel, sichere Reifeneinlagerung sowie Reifen & Felgen. Jetzt bequem online einen Termin buchen.');
  var ogBild = seo.og_bild && String(seo.og_bild).trim() ? absUrl(seo.og_bild) : 'https://www.schroeder-scholz.de/uploads/hero.jpg';

  return '<!DOCTYPE html><html lang="de"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>' + esc(title) + '</title>' +
    '<meta name="description" content="' + esc(desc) + '">' +
    '<meta name="robots" content="index, follow">' +
    '<link rel="canonical" href="https://www.schroeder-scholz.de/">' +
    '<meta property="og:type" content="website"><meta property="og:title" content="' + esc(title) + '">' +
    '<meta property="og:description" content="' + esc(desc) + '"><meta property="og:url" content="https://www.schroeder-scholz.de/">' +
    '<meta property="og:image" content="' + esc(ogBild) + '">' +
    '<meta property="og:image:width" content="1600"><meta property="og:image:height" content="760">' +
    '<meta property="og:site_name" content="Schröder &amp; Scholz"><meta property="og:locale" content="de_DE">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + esc(title) + '">' +
    '<meta name="twitter:description" content="' + esc(desc) + '">' +
    '<meta name="twitter:image" content="' + esc(ogBild) + '">' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' +
    '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">' +
    '<script type="application/ld+json">' + jsonLd(f, oz) + '</scr' + 'ipt>' +
    '<style>' + css(f, fonts) + extraCss() + '</style></head><body>' +
    bannerHtml(f) +
    '<header class="nav"><div class="nav-in">' +
    menueKnopfHtml() +
    '<a href="/" class="wm" aria-label="Schröder & Scholz">' + logoSvg(212, 38) + '</a>' +
    '<div class="nav-right">' + navHtml(f) + telHtml(f) + '</div>' +
    '</div></header>' +
    '<main>' + body + '</main>' +
    '<footer class="foot"><div class="inner">' +
    '<div class="foot-logo">' + logoSvg(252, 45) + '</div>' +
    socialHtml(f) +
    '<div class="foot-links"><a href="/portal/">Kundenportal</a> · <a href="/portal/impressum.html">Impressum</a> · <a href="/portal/datenschutz.html">Datenschutz</a> · <a href="/portal/agb.html">AGB</a> · <a href="/portal/widerruf.html">Widerrufsbelehrung</a> · <a href="/portal/faq.html">FAQ</a></div>' +
    '</div></footer>' + script() + '</body></html>';
}

// Design-Standardwerte (entsprechen exakt dem bisherigen fest verdrahteten Look)
function designDefaults() {
  return {
    font_head: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif",
    font_body: "-apple-system,'Segoe UI',Roboto,Arial,sans-serif",
    akzent: '#eab308', akzent_ink: '#171717', dunkel: '#171717', skala: 1
  };
}
function designConfig(f) {
  var d = designDefaults();
  var c = f && f.design_config && typeof f.design_config === 'object' ? f.design_config : null;
  if (c) {
    if (c.font_head) d.font_head = String(c.font_head);
    if (c.font_body) d.font_body = String(c.font_body);
    if (/^#[0-9a-fA-F]{3,8}$/.test(c.akzent || '')) d.akzent = c.akzent;
    if (/^#[0-9a-fA-F]{3,8}$/.test(c.akzent_ink || '')) d.akzent_ink = c.akzent_ink;
    if (/^#[0-9a-fA-F]{3,8}$/.test(c.dunkel || '')) d.dunkel = c.dunkel;
    var sk = parseFloat(c.skala); if (!isNaN(sk) && sk >= 0.7 && sk <= 1.6) d.skala = sk;
  }
  return d;
}
// Hochgeladene Schriften als @font-face einbinden (selbst gehostet, kein externes CDN)
function fontFaceCss(fonts) {
  return (fonts || []).map(function(x) {
    return "@font-face{font-family:'" + String(x.familie).replace(/['\\]/g, '') +
      "';src:url('/uploads/fonts/" + encodeURIComponent(x.datei) + "') format('" + esc(x.format) +
      "');font-display:swap}";
  }).join('');
}
function css(f, fonts) {
  var d = designConfig(f);
  var root = ':root{--accent:' + d.akzent + ';--accent-ink:' + d.akzent_ink + ';--dark:' + d.dunkel +
    ';--font-head:' + d.font_head + ';--font-body:' + d.font_body + ';--sc:' + d.skala + '}';
  return fontFaceCss(fonts) + root +
    "*{margin:0;padding:0;box-sizing:border-box}" +
    "body{font-family:var(--font-body);color:#1a1a1a;background:#fff;line-height:1.6;font-size:calc(16px*var(--sc))}" +
    "h1,h2,h3{font-family:var(--font-head)}" +
    "a{color:inherit;text-decoration:none}" +
    ".inner{max-width:1240px;margin:0 auto;padding:0 24px}.narrow{max-width:760px}" +
    ".akt-leiste{background:var(--accent);color:var(--accent-ink);display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;padding:11px 18px;font-weight:600;font-size:calc(14.5px*var(--sc));text-align:center}" +
    ".akt-code{background:var(--dark);color:var(--accent);padding:3px 12px;border-radius:6px;font-weight:800;letter-spacing:1.5px}" +
    ".akt-cta{background:var(--dark);color:#fff;padding:7px 16px;border-radius:8px;font-weight:700;white-space:nowrap}" +
    ".akt-ecke{position:fixed;top:88px;z-index:60;max-width:280px;background:var(--dark);color:#fff;border:2px solid var(--accent);border-radius:14px;padding:18px 18px 16px;box-shadow:0 12px 30px rgba(0,0,0,.35)}" +
    ".akt-ecke.links{left:18px}.akt-ecke.rechts{right:18px}" +
    ".akt-ecke .akt-text{display:block;font-weight:600;font-size:15px;margin-bottom:12px;line-height:1.45}" +
    ".akt-ecke .akt-code{display:inline-block;margin-bottom:12px}.akt-ecke .akt-cta{display:inline-block}" +
    ".akt-x{position:absolute;top:6px;right:10px;background:none;border:none;color:#cfcfcf;font-size:20px;line-height:1;cursor:pointer}" +
    "@media(max-width:600px){.akt-ecke{left:12px;right:12px;max-width:none;top:auto;bottom:12px}}" +
    ".nav{position:sticky;top:0;z-index:50;background:var(--dark);border-bottom:3px solid var(--accent)}" +
    ".nav-in{max-width:1240px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}" +
    ".wm{display:inline-flex;align-items:center}.wm svg{height:38px;width:auto}" +
    ".nav-links{display:flex;align-items:center;gap:20px;flex-wrap:wrap}.nav-links a{color:#e6e6e6;font-size:calc(14px*var(--sc));font-weight:600}.nav-links a:hover{color:var(--accent)}" +
    ".btn-sm{background:var(--accent);color:var(--accent-ink)!important;padding:8px 16px;border-radius:8px}" +
    ".nav-right{display:flex;align-items:center;gap:16px;flex-wrap:wrap}" +
    ".nav{position:relative}" +
    ".nav-burger{display:none;background:none;border:1px solid rgba(255,255,255,.3);border-radius:8px;color:#fff;padding:7px 9px;cursor:pointer;align-items:center}" +
    ".nav-burger svg{width:22px;height:22px;display:block}" +
    ".nav-burger .b-zu{display:none}" +
    ".nav-burger[aria-expanded='true'] .b-auf{display:none}.nav-burger[aria-expanded='true'] .b-zu{display:block}" +
    ".nav-burger:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    ".nav-tel{display:inline-flex;align-items:center;gap:8px;color:#fff;font-size:calc(14px*var(--sc));font-weight:700;border:1px solid rgba(255,255,255,.3);padding:7px 14px;border-radius:8px;white-space:nowrap}" +
    ".nav-tel svg{width:16px;height:16px;color:var(--accent);flex:none}" +
    ".nav-tel:hover{border-color:var(--accent);color:var(--accent)}.nav-tel:hover svg{color:var(--accent)}" +
    ".hero{min-height:62vh;display:flex;align-items:center;background-size:cover;background-position:center;color:#fff}" +
    ".hero-in{max-width:1240px;margin:0 auto;padding:60px 24px}" +
    ".hero h1{font-size:clamp(calc(30px*var(--sc)),5vw,calc(52px*var(--sc)));font-weight:800;max-width:16em;line-height:1.15}" +
    ".hero p{font-size:clamp(calc(16px*var(--sc)),2.2vw,calc(20px*var(--sc)));margin:18px 0 28px;max-width:34em;color:#e6e6e6}" +
    ".btn{display:inline-block;background:var(--accent);color:var(--accent-ink);font-weight:700;padding:15px 32px;border-radius:10px;font-size:calc(16px*var(--sc))}" +
    ".btn-ghost{display:inline-block;border:1px solid var(--dark);color:var(--dark);font-weight:700;padding:11px 24px;border-radius:10px}" +
    ".sec{padding:64px 0}.sec.alt{background:#f6f7f9}.sec h2{font-size:clamp(calc(24px*var(--sc)),3.5vw,calc(34px*var(--sc)));font-weight:800;margin-bottom:28px}" +
    ".cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}" +
    ".card-link{height:100%}.card-link:hover .card{border-color:var(--accent);box-shadow:0 10px 26px rgba(0,0,0,.08);transform:translateY(-2px);transition:.15s}" +
    ".card-cta{margin-top:12px;font-size:calc(14px*var(--sc));font-weight:700;color:var(--accent)}" +
    ".card{background:#fff;border:1px solid #e6e8ec;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);display:flex;flex-direction:column;height:100%}" +
    ".card-img{aspect-ratio:4/3;background:#eef0f3}.card-img img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".card-body{padding:22px 24px}" +
    ".card-nr{font-size:calc(13px*var(--sc));font-weight:800;color:var(--accent);margin-bottom:8px}.card h3{font-size:calc(19px*var(--sc));margin-bottom:8px}.card .rt{color:#555;font-size:calc(15px*var(--sc))}" +
    ".t-grid{display:grid;grid-template-columns:1fr 1fr;gap:36px;align-items:center}.t-text .rt{color:#444;font-size:calc(16px*var(--sc))}" +
    ".rt a{color:var(--accent);text-decoration:underline}.rt ul,.rt ol{margin:8px 0 8px 20px}.rt li{margin:3px 0}.rt p{margin:0 0 10px}.rt p:last-child{margin-bottom:0}" +
    ".faq-i{border:1px solid #e6e8ec;border-radius:10px;margin-bottom:10px;background:#fff;overflow:hidden}.faq-i summary{cursor:pointer;padding:15px 18px;font-weight:700;font-size:calc(16px*var(--sc));list-style:none;display:flex;justify-content:space-between;align-items:center;gap:12px}.faq-i summary::-webkit-details-marker{display:none}.faq-i summary::after{content:'+';color:var(--accent);font-size:22px;font-weight:800;flex:none}.faq-i[open] summary::after{content:'\\2212'}.faq-a{padding:0 18px 16px;color:#555;font-size:calc(15px*var(--sc));line-height:1.6}" +
    ".ks-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}.ks-card{background:#fff;border:1px solid #e6e8ec;border-radius:14px;padding:22px;margin:0}.ks-card blockquote{margin:10px 0 0;font-size:calc(15px*var(--sc));color:#333;line-height:1.6}.ks-card figcaption{margin-top:12px;font-weight:700;color:#555;font-size:14px}.stars{display:inline-flex;gap:2px}.star{color:#d9d9d9;font-size:16px}.star.on{color:var(--accent)}" +
    ".gal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.gal-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block}" +
    ".t-img{aspect-ratio:4/3;border-radius:14px;overflow:hidden;background:#eef0f3}.t-img img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".oz{width:100%;border-collapse:collapse;font-size:calc(16px*var(--sc))}.oz td{padding:12px 0;border-bottom:1px solid #e6e8ec}.oz td:last-child{text-align:right;font-weight:700}" +
    ".oz-hinweis{margin:14px 0 0;color:#555;font-size:calc(15px*var(--sc));line-height:1.6}" +
    ".oz-bes{margin-top:26px}.oz-bes h3{font-size:calc(15px*var(--sc));text-transform:uppercase;letter-spacing:1.5px;color:#555;margin:0 0 6px}" +
    ".oz-bes .oz td{padding:9px 0;font-size:calc(15px*var(--sc))}.oz td{vertical-align:top}" +
    // Auf dem Handy Datum und Zeit untereinander statt gequetscht nebeneinander
    "@media(max-width:600px){.oz-bes .oz tr{display:block;border-bottom:1px solid #e6e8ec;padding:8px 0}" + ".oz-bes .oz td{display:block;padding:0;border:none}.oz-bes .oz td:last-child{text-align:left;margin-top:2px}}" +
    "#kontakt p{margin-bottom:10px;font-size:calc(16px*var(--sc))}" +
    ".k-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}" +
    ".k-card{background:#fff;border:1px solid #e6e8ec;border-radius:14px;padding:24px;margin-bottom:20px}.k-card h3{font-size:calc(20px*var(--sc));margin-bottom:10px}" +
    ".k-map{aspect-ratio:16/10;border-radius:14px;overflow:hidden;border:1px solid #e6e8ec;background:#eef0f3}.k-map iframe{width:100%;height:100%;border:0;display:block}" +
    ".k-map-ph{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px}.k-map-ph p{font-weight:700;color:#444;margin:0}" +
    ".k-map-note{font-size:12px;color:#777;max-width:340px;line-height:1.5}.k-map-note a{color:#171717;text-decoration:underline}" +
    ".k-form{background:#fff;border:1px solid #e6e8ec;border-radius:14px;padding:24px;display:flex;flex-direction:column;gap:12px}.k-form h3{font-size:calc(20px*var(--sc));margin-bottom:4px}" +
    ".k-form input,.k-form textarea{width:100%;border:1px solid #d5d9e0;border-radius:8px;padding:12px 14px;font-size:15px;font-family:inherit;background:#fff;color:#1a1a1a}" +
    ".k-form input:focus,.k-form textarea:focus{outline:none;border-color:var(--accent)}.k-form textarea{min-height:130px;resize:vertical}.k-form .btn{border:none;cursor:pointer;font-family:inherit;align-self:flex-start}" +
    ".kf-check{font-size:13px;color:#555;display:flex;gap:8px;align-items:flex-start;line-height:1.5}.kf-check input{width:auto;margin-top:3px}.kf-check a{color:#171717;text-decoration:underline}" +
    ".kf-ok{display:none;background:#e7f7ee;color:#0f6b3e;border:1px solid #b7e4cd;border-radius:8px;padding:12px 14px;font-size:14px}" +
    ".kf-err{display:none;background:#fdecea;color:#b3261e;border:1px solid #f5c6c2;border-radius:8px;padding:12px 14px;font-size:14px}" +
    ".buchung{background:var(--dark)}.buchung h2{color:#fff}.bk-intro{color:#cfcfcf;max-width:46em;margin:-10px 0 22px;font-size:calc(16px*var(--sc))}" +
    ".bk-card{background:#fff;border-radius:16px;padding:26px;max-width:760px;box-shadow:0 18px 40px rgba(0,0,0,.35)}" +
    ".bk-card label{display:block;font-size:12px;font-weight:700;color:#555;margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px}" +
    ".bk-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}" +
    ".bk-card input,.bk-card select{width:100%;border:1px solid #d5d9e0;border-radius:9px;padding:12px 13px;font-size:15px;font-family:inherit;background:#fff;color:#1a1a1a}" +
    ".bk-card input:focus,.bk-card select:focus{outline:none;border-color:var(--accent)}" +
    ".bk-kz{display:flex;gap:5px;align-items:center}.bk-kz span{color:#999}.bk-kz input{text-align:center;font-family:monospace;text-transform:uppercase;padding:12px 4px}" +
    ".bk-kz input:nth-child(1){flex:0 0 58px}.bk-kz input:nth-child(3){flex:0 0 46px}.bk-kz input:nth-child(5){flex:0 0 52px}.bk-kz input:nth-child(6){flex:0 0 40px}" +
    ".bk-slots{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.bk-slot{border:1px solid #d5d9e0;background:#fff;border-radius:8px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer;color:#1a1a1a}" +
    ".bk-slot:hover{border-color:var(--accent)}.bk-slot.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}" +
    ".bk-info{font-size:13px;color:#888;margin-top:8px}" +
    ".bk-check{display:flex;gap:9px;align-items:flex-start;font-size:13px;color:#555;text-transform:none;letter-spacing:0;font-weight:400;margin:16px 0 4px;line-height:1.5}.bk-check input{width:auto;margin-top:3px}.bk-check a{color:#171717;text-decoration:underline}" +
    ".bk-card .btn{border:none;cursor:pointer;font-family:inherit;margin-top:14px;width:100%;justify-content:center}" +
    ".bk-ok{display:none;background:#e7f7ee;color:#0f6b3e;border:1px solid #b7e4cd;border-radius:9px;padding:13px 15px;font-size:14px;margin-top:12px}" +
    ".bk-err{display:none;background:#fdecea;color:#b3261e;border:1px solid #f5c6c2;border-radius:9px;padding:13px 15px;font-size:14px;margin-top:12px}" +
    ".foot{background:var(--dark);color:#cfcfcf;padding:40px 0;text-align:center}.foot-logo{display:flex;justify-content:center;margin-bottom:18px}.foot-logo svg{max-width:90%;height:auto}" +
    ".foot-links{font-size:calc(13px*var(--sc))}.foot-links a{color:#cfcfcf}.foot-links a:hover{color:var(--accent)}" +
    ".foot-social{display:flex;gap:14px;justify-content:center;margin:6px 0 14px}.foot-social a{color:#cfcfcf;display:inline-flex}.foot-social a:hover{color:var(--accent)}" +
    ".foot-bewerten{display:inline-block;margin:0 0 16px;font-size:13px;font-weight:700;color:var(--accent-ink);background:var(--accent);padding:9px 18px;border-radius:8px;text-decoration:none}.foot-bewerten:hover{filter:brightness(1.05)}" +
    "@media(max-width:760px){.t-grid{grid-template-columns:1fr}.t-img{order:-1}.k-grid{grid-template-columns:1fr}.bk-grid{grid-template-columns:1fr}.bk-card{padding:18px}.nav-in{display:grid;grid-template-columns:46px 1fr 46px;align-items:center;gap:10px;padding-left:calc(14px + env(safe-area-inset-left));padding-right:calc(14px + env(safe-area-inset-right))}.nav-burger{display:inline-flex;justify-content:center;width:46px;height:46px;padding:0;justify-self:start}.wm{justify-self:center}.wm svg{height:30px;width:auto}.nav-right{gap:0;justify-self:end}.nav-tel{width:46px;height:46px;padding:0;justify-content:center;background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}.nav-tel svg{width:21px;height:21px;color:var(--accent-ink)}.nav-tel .tel-nr{display:none}.nav-tel:hover{border-color:var(--accent);color:var(--accent-ink)}.nav-tel:hover svg{color:var(--accent-ink)}.nav-links{position:absolute;left:0;right:0;top:100%;flex-direction:column;align-items:stretch;gap:0;background:var(--dark);border-top:1px solid rgba(255,255,255,.12);padding:6px 24px 18px;display:none;z-index:60}.nav-links.offen{display:flex}.nav-links a{padding:14px 2px;border-bottom:1px solid rgba(255,255,255,.09);font-size:calc(16px*var(--sc))}.nav-links a:last-child{border-bottom:none}.nav-links a.btn-sm{margin-top:12px;text-align:center;padding:12px 16px;border-bottom:none;background:transparent;color:#e6e6e6!important;border:1px solid rgba(255,255,255,.3);border-radius:8px;font-weight:600}.nav-links a[href*='/termin/']{background:var(--accent);color:var(--accent-ink)!important;border-radius:8px;margin:12px 0 2px;text-align:center;padding:14px 16px;font-weight:800;border-bottom:none}.sec{padding:44px 0}.wm svg{height:30px}}";
}

function script() {
  return "<scr" + "ipt>" +
    // ── Visueller Editor (nur bei ?editor=1, im CMS-iframe) ──
    "(function(){if(location.search.indexOf('editor=1')===-1)return;" +
    "var st=document.createElement('style');st.textContent='[data-sektion-id]{cursor:pointer}[data-sektion-id]:hover{outline:3px solid #eab308;outline-offset:-3px}.cms-hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;background:#171717;color:#fff;border:1px solid #eab308;border-radius:30px;padding:11px 22px;font:600 13px -apple-system,Arial,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.45)}.cms-hint b{color:#eab308}';document.head.appendChild(st);" +
    "var hint=document.createElement('div');hint.className='cms-hint';hint.innerHTML='\\u270E Bearbeitungsmodus \\u2013 <b>Bereich anklicken</b> zum Bearbeiten';document.body.appendChild(hint);" +
    "document.addEventListener('click',function(ev){var el=ev.target.closest&&ev.target.closest('[data-sektion-id]');if(el){ev.preventDefault();ev.stopPropagation();parent.postMessage({type:'cms-edit',id:el.getAttribute('data-sektion-id')},'*');return;}var a=ev.target.closest&&ev.target.closest('a');if(a)ev.preventDefault();},true);" +
    // Live-Design-Vorschau: CMS schickt Design-Variablen, wir wenden sie sofort an (ohne Speichern)
    "window.addEventListener('message',function(ev){if(ev.origin.indexOf('schroeder-scholz.de')===-1)return;var d=ev.data;if(!d||d.type!=='cms-design'||!d.vars)return;var r=document.documentElement.style,v=d.vars,set=function(k,x){if(x)r.setProperty(k,x);};set('--accent',v.accent);set('--accent-ink',v.accent_ink);set('--dark',v.dunkel);set('--font-head',v.font_head);set('--font-body',v.font_body);if(v.sc)r.setProperty('--sc',v.sc);});" +
    "})();" +
    "function menueUmschalten(k){var n=document.getElementById('hauptmenue');if(!n)return;" +
    "var auf=n.classList.toggle('offen');k.setAttribute('aria-expanded',auf?'true':'false');" +
    "k.setAttribute('aria-label',auf?'Men\u00fc schlie\u00dfen':'Men\u00fc \u00f6ffnen');}" +
    // Nach dem Antippen eines Punktes und beim Tippen daneben wieder schliessen — sonst
    // verdeckt das offene Menue den Abschnitt, zu dem es gerade gesprungen ist.
    "document.addEventListener('click',function(ev){var n=document.getElementById('hauptmenue');" +
    "if(!n||!n.classList.contains('offen'))return;" +
    "if(ev.target.closest&&ev.target.closest('.nav-burger'))return;" +
    "var drin=ev.target.closest&&ev.target.closest('#hauptmenue');" +
    "var link=ev.target.closest&&ev.target.closest('#hauptmenue a');" +
    "if(link||!drin){n.classList.remove('offen');var b=document.querySelector('.nav-burger');" +
    "if(b){b.setAttribute('aria-expanded','false');b.setAttribute('aria-label','Men\u00fc \u00f6ffnen');}}});" +
    "function ladeKarte(){var m=document.getElementById('kmap');if(!m)return;var u=m.getAttribute('data-embed');" +
    "m.innerHTML='<iframe src=\"'+u+'\" loading=\"lazy\" referrerpolicy=\"no-referrer-when-downgrade\" title=\"Standortkarte\"></iframe>';}" +
    "function kfv(id){var e=document.getElementById(id);return e?e.value.trim():'';}" +
    "function sendeKontakt(ev){ev.preventDefault();var ok=document.getElementById('kf-ok'),er=document.getElementById('kf-err');ok.style.display='none';er.style.display='none';" +
    "var d={name:kfv('kf-name'),email:kfv('kf-email'),telefon:kfv('kf-telefon'),nachricht:kfv('kf-nachricht'),datenschutz:document.getElementById('kf-dsgvo').checked,website:kfv('kf-hp')};" +
    "if(!d.name||!d.email||!d.nachricht||!d.datenschutz){er.textContent='Bitte Name, E-Mail und Nachricht ausfüllen und den Datenschutz bestätigen.';er.style.display='block';return false;}" +
    "var b=ev.target.querySelector('button[type=submit]');b.disabled=true;var bt=b.textContent;b.textContent='Wird gesendet …';" +
    "fetch('/api/kontakt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})" +
    ".then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Fehler beim Senden.');return j;});})" +
    ".then(function(){ev.target.reset();ok.style.display='block';ok.scrollIntoView({behavior:'smooth',block:'center'});})" +
    ".catch(function(x){er.textContent=x.message;er.style.display='block';})" +
    ".then(function(){b.disabled=false;b.textContent=bt;});return false;}" +
    // ── Online-Terminbuchung (Gast) ──
    "var bkSel=null;" +
    "function bkv(id){var e=document.getElementById(id);return e?e.value.trim():'';}" +
    "(function(){var a=document.getElementById('bk-art');if(!a)return;" +
    "var dt=document.getElementById('bk-datum');var n=new Date();dt.min=n.getFullYear()+'-'+('0'+(n.getMonth()+1)).slice(-2)+'-'+('0'+n.getDate()).slice(-2);" +
    "fetch('/api/gast/artikel').then(function(r){return r.json();}).then(function(rows){(rows||[]).forEach(function(x){var o=document.createElement('option');o.value=x.id;o.textContent=x.name;a.appendChild(o);});}).catch(function(){});" +
    "var sc=document.getElementById('bk-slots');if(sc){sc.addEventListener('click',function(ev){var t=ev.target;if(t&&t.className&&t.className.indexOf('bk-slot')!==-1){bkPick(t,t.getAttribute('data-von'));}});}" +
    "})();" +
    "function bkSlots(){bkSel=null;var art=bkv('bk-art'),datum=bkv('bk-datum');var w=document.getElementById('bk-slots-wrap'),sl=document.getElementById('bk-slots'),info=document.getElementById('bk-slots-info');if(!art||!datum){w.style.display='none';return;}w.style.display='block';sl.innerHTML='';info.textContent='Lädt …';" +
    "fetch('/api/gast/slots?datum='+encodeURIComponent(datum)+'&artikel_id='+encodeURIComponent(art)).then(function(r){return r.json();}).then(function(d){info.textContent='';if(d.grund){info.textContent='An diesem Tag ist keine Buchung möglich ('+d.grund+'). Bitte einen anderen Tag wählen.';return;}if(!d.slots||!d.slots.length){info.textContent='Keine freien Zeiten an diesem Tag.';return;}sl.innerHTML=d.slots.map(function(s){return '<button type=button class=bk-slot data-von='+s.von+'>'+s.von+'</button>';}).join('');}).catch(function(){info.textContent='Zeiten konnten nicht geladen werden.';});}" +
    "function bkPick(btn,von){bkSel=von;var all=document.querySelectorAll('.bk-slot');for(var i=0;i<all.length;i++)all[i].classList.remove('on');btn.classList.add('on');}" +
    "function bkKz(){var k=[bkv('bk-kz1'),bkv('bk-kz2'),bkv('bk-kz3')].filter(Boolean).join('-');var k4=bkv('bk-kz4');if(k4)k+=' '+k4;return k.trim();}" +
    "function gastBuchen(ev){ev.preventDefault();var ok=document.getElementById('bk-ok'),er=document.getElementById('bk-err');ok.style.display='none';er.style.display='none';var kz=bkKz();" +
    "var d={name:bkv('bk-name'),telefon:bkv('bk-tel'),email:bkv('bk-email'),kennzeichen:kz,datum:bkv('bk-datum'),uhrzeit_von:bkSel,artikel_id:bkv('bk-art'),datenschutz:document.getElementById('bk-dsgvo').checked,website:bkv('bk-hp')};" +
    "if(!d.artikel_id||!d.datum){er.textContent='Bitte Leistung und Datum wählen.';er.style.display='block';return false;}" +
    "if(!d.uhrzeit_von){er.textContent='Bitte eine Uhrzeit wählen.';er.style.display='block';return false;}" +
    "if(!d.name||!d.telefon||!d.email||!kz){er.textContent='Bitte Name, Telefon, E-Mail und Kennzeichen ausfüllen.';er.style.display='block';return false;}" +
    "if(!d.datenschutz){er.textContent='Bitte stimme der Datenschutzerklärung zu.';er.style.display='block';return false;}" +
    "var b=document.getElementById('bk-submit');b.disabled=true;var bt=b.textContent;b.textContent='Wird gebucht …';" +
    "fetch('/api/gast/termin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})" +
    ".then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Buchung fehlgeschlagen.');return j;});})" +
    ".then(function(j){ev.target.reset();bkSel=null;document.getElementById('bk-slots-wrap').style.display='none';ok.innerHTML='Vielen Dank! Dein Termin am '+String(j.datum||'').split('-').reverse().join('.')+' um '+(j.uhrzeit_von||'')+' Uhr ist bestätigt. Du bekommst eine Bestätigung per E-Mail.';ok.style.display='block';ok.scrollIntoView({behavior:'smooth',block:'center'});})" +
    ".catch(function(x){er.textContent=x.message;er.style.display='block';})" +
    ".then(function(){b.disabled=false;b.textContent=bt;});return false;}" +
    "</scr" + "ipt>";
}

// Coming-Soon-/Wartungsseite: grosses Logo, "bald fuer dich da", Buchungsstart-Datum.
// Auf Marke (dunkel + Gold), keine Navigation/Buchung, noindex (Platzhalter nicht indexieren).
function renderWartung(f) {
  f = f || {};
  // Buchungsstart-Datum dynamisch aus einstellungen.buchbar_ab (Single Source of Truth) —
  // damit die Coming-Soon-Seite nie vom echten Buchungsstart (/termin/) abweicht.
  var _MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var _ba = (f.buchbar_ab && /^\d{4}-\d{2}-\d{2}$/.test(String(f.buchbar_ab))) ? String(f.buchbar_ab).split('-') : null;
  var startDatum = _ba ? (parseInt(_ba[2], 10) + '. ' + _MON[parseInt(_ba[1], 10) - 1] + ' ' + _ba[0]) : null;
  var datumSatz = startDatum
    ? 'Ab dem <b>' + startDatum + '</b> kannst du hier online deinen Termin buchen.'
    : 'Die Online-Terminbuchung startet <b>in Kürze</b>.';
  var metaDesc = 'Schröder & Scholz – Reifenservice und Fahrzeugtechnik. Unsere neue Website ist bald da.' + (startDatum ? ' Ab ' + startDatum + ' online Termine buchen.' : '');
  // Reine Info-Seite: nur Logo, Headline und Buchungsstart-Datum – kein Kontakt,
  // keine Rechtslinks (bewusst auf Wunsch von David).
  return '<!DOCTYPE html><html lang="de"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Schröder &amp; Scholz &ndash; bald für dich da</title>' +
    '<meta name="description" content="' + esc(metaDesc) + '">' +
    '<meta name="robots" content="noindex">' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' +
    '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}' +
    'body{font-family:-apple-system,\'Segoe UI\',Roboto,Arial,sans-serif;background:#0d1117;color:#e6e6e6;min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px 20px 72px;position:relative;overflow:hidden}' +
    '.ws-glow{position:fixed;inset:0;background:radial-gradient(circle at 50% 28%,rgba(234,179,8,.15),transparent 60%);pointer-events:none}' +
    '.ws-logo{width:min(88vw,520px);margin:0 auto 42px}.ws-logo svg{width:100%;height:auto;display:block}' +
    '.ws-badge{display:inline-block;background:rgba(234,179,8,.12);border:1px solid rgba(234,179,8,.5);color:#eab308;font-weight:700;letter-spacing:.6px;font-size:12.5px;text-transform:uppercase;padding:8px 16px;border-radius:999px;margin-bottom:26px}' +
    'h1{font-size:clamp(30px,6vw,56px);font-weight:800;color:#fafafa;line-height:1.1;letter-spacing:-1px}h1 .akz{color:#eab308}' +
    '.ws-sub{font-size:clamp(16px,2.4vw,20px);color:#b9c0c9;margin:20px auto 0;max-width:34em;line-height:1.6}' +
    '.ws-line{width:82px;height:4px;background:#eab308;border-radius:4px;margin:30px auto 0;position:relative;overflow:hidden}' +
    '.ws-line::after{content:"";position:absolute;top:0;left:-44px;width:44px;height:100%;background:rgba(255,255,255,.65);filter:blur(6px);animation:wssh 2.4s infinite}' +
    '@keyframes wssh{0%{left:-44px}60%,100%{left:104px}}' +
    '.ws-datum{margin:34px auto 0;font-size:clamp(18px,2.6vw,23px);color:#fafafa;font-weight:700;line-height:1.4}.ws-datum b{color:#eab308}' +
    '.ws-kontakt{margin:32px auto 0;font-size:15px;color:#9aa0a6}.ws-kontakt a{color:#eab308;text-decoration:none}.ws-kontakt a:hover{text-decoration:underline}' +
    '.ws-tag{margin-top:16px;font-size:11.5px;letter-spacing:3px;color:#6b7280;text-transform:uppercase}' +
    '.ws-foot{position:fixed;bottom:18px;left:0;right:0;font-size:12.5px;color:#6b7280}.ws-foot a{color:#9aa0a6;text-decoration:none;margin:0 9px}.ws-foot a:hover{color:#eab308}' +
    '</style></head><body>' +
    '<div class="ws-glow"></div>' +
    '<div class="ws-logo">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 92" width="560" height="92" style="display:block">' +
        '<text x="280" y="46" text-anchor="middle" font-family="-apple-system,\'Helvetica Neue\',Arial,sans-serif" font-size="42" font-weight="800" letter-spacing="-1.5" fill="#fafafa">SCHRÖDER <tspan fill="#eab308">&amp;</tspan> SCHOLZ</text>' +
        '<text x="280" y="76" text-anchor="middle" font-family="-apple-system,\'Helvetica Neue\',Arial,sans-serif" font-size="12" font-weight="600" letter-spacing="3" fill="#a3a3a3">REIFENSERVICE UND FAHRZEUGTECHNIK</text>' +
      '</svg>' +
    '</div>' +
    '<div class="ws-badge">Neue Website in Arbeit</div>' +
    '<h1>Wir sind bald <span class="akz">für dich</span> da.</h1>' +
    '<p class="ws-sub">Unsere neue Website steht in den Startlöchern &ndash; gleich alles rund um Reifen und Fahrzeugtechnik, bequem online.</p>' +
    '<div class="ws-line"></div>' +
    '<p class="ws-datum">' + datumSatz + '</p>' +
    '<div class="ws-foot"><a href="/portal/impressum.html">Impressum</a>&middot;<a href="/portal/datenschutz.html">Datenschutz</a></div>' +
    '</body></html>';
}

module.exports = { renderHomepage, renderWartung };
