'use strict';
// Rendert die Homepage als statisches HTML aus den DB-Sektionen + Firmendaten.
// Liegt auf dem Server unter src/lib/homepage-render.js

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function hm(t) { return t ? String(t).substring(0, 5) : ''; }
function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

function oeffnungszeilen(f) {
  var z = [];
  if (f.mo_fr_von && f.mo_fr_bis) z.push(['Mo – Fr', hm(f.mo_fr_von) + ' – ' + hm(f.mo_fr_bis)]);
  if (f.sa_offen && f.sa_von && f.sa_bis) z.push(['Samstag', hm(f.sa_von) + ' – ' + hm(f.sa_bis)]);
  if (f.so_offen && f.so_von && f.so_bis) z.push(['Sonntag', hm(f.so_von) + ' – ' + hm(f.so_bis)]);
  return z;
}

function jsonLd(f) {
  var data = {
    '@context': 'https://schema.org', '@type': 'AutoRepair',
    name: 'Schröder & Scholz',
    description: 'Reifenservice und Fahrzeugtechnik: Räderwechsel, Reifeneinlagerung, Reifen & Felgen, HU/TÜV-Service.',
    url: 'https://www.schroeder-scholz.de/',
    image: 'https://www.schroeder-scholz.de/uploads/hero.jpg'
  };
  if (f.telefon) data.telephone = f.telefon;
  if (f.email) data.email = f.email;
  if (f.strasse || f.ort) data.address = { '@type': 'PostalAddress', streetAddress: f.strasse || '', postalCode: f.plz || '', addressLocality: f.ort || '', addressCountry: 'DE' };
  var oh = [];
  if (f.mo_fr_von && f.mo_fr_bis) oh.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: hm(f.mo_fr_von), closes: hm(f.mo_fr_bis) });
  if (f.sa_offen && f.sa_von && f.sa_bis) oh.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: 'Saturday', opens: hm(f.sa_von), closes: hm(f.sa_bis) });
  if (oh.length) data.openingHoursSpecification = oh;
  return JSON.stringify(data);
}

function renderLeistungen(group) {
  var cards = group.map(function(s, i) {
    var nr = String(i + 1).padStart(2, '0');
    return '<div class="card">' +
      '<div class="card-nr">' + nr + '</div>' +
      '<h3>' + esc(s.headline || '') + '</h3>' +
      '<p>' + nl2br(s.inhalt || '') + '</p>' +
      '</div>';
  }).join('');
  return '<section class="sec" id="leistungen"><div class="inner">' +
    '<h2>Unsere Leistungen</h2><div class="cards">' + cards + '</div></div></section>';
}

function renderSektion(s, f) {
  if (s.typ === 'hero') {
    var bg = s.bild_url ? "linear-gradient(rgba(13,17,23,.55),rgba(13,17,23,.8)), url('" + esc(s.bild_url) + "')" : 'linear-gradient(135deg,#171717,#0d1117)';
    return '<section class="hero" style="background-image:' + bg + '">' +
      '<div class="hero-in">' +
      '<h1>' + esc(s.headline || '') + '</h1>' +
      (s.subline ? '<p>' + esc(s.subline) + '</p>' : '') +
      (s.cta_text ? '<a class="btn" href="' + esc(s.cta_url || '/portal/') + '">' + esc(s.cta_text) + '</a>' : '') +
      '</div></section>';
  }
  if (s.typ === 'oeffnungszeiten') {
    var rows = oeffnungszeilen(f).map(function(r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') || '<tr><td colspan="2">Bitte erfragen Sie unsere Öffnungszeiten.</td></tr>';
    return '<section class="sec alt" id="oeffnungszeiten"><div class="inner narrow"><h2>' + esc(s.headline || 'Öffnungszeiten') + '</h2>' +
      '<table class="oz">' + rows + '</table></div></section>';
  }
  if (s.typ === 'kontakt') {
    var adr = [f.strasse, ((f.plz || '') + ' ' + (f.ort || '')).trim()].filter(Boolean).map(esc).join('<br>');
    var maps = (f.strasse || f.ort) ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([f.firmenname, f.strasse, f.plz, f.ort].filter(Boolean).join(' ')) : '';
    return '<section class="sec" id="kontakt"><div class="inner narrow"><h2>' + esc(s.headline || 'Kontakt & Anfahrt') + '</h2>' +
      '<p>' + (adr || '<span style="color:#8b949e">Adresse folgt in Kürze.</span>') + '</p>' +
      (f.telefon ? '<p>Telefon: <a href="tel:' + esc(f.telefon) + '">' + esc(f.telefon) + '</a></p>' : '') +
      (f.email ? '<p>E-Mail: <a href="mailto:' + esc(f.email) + '">' + esc(f.email) + '</a></p>' : '') +
      (maps ? '<p><a class="btn-ghost" href="' + maps + '" target="_blank" rel="noopener">Route planen</a></p>' : '') +
      '</div></section>';
  }
  // text
  var img = s.bild_url ? '<div class="t-img"><img src="' + esc(s.bild_url) + '" alt="' + esc(s.headline || '') + '" loading="lazy"></div>' : '';
  return '<section class="sec"><div class="inner t-grid">' +
    '<div class="t-text"><h2>' + esc(s.headline || '') + '</h2><p>' + nl2br(s.inhalt || '') + '</p></div>' + img +
    '</div></section>';
}

function renderHomepage(sektionen, f) {
  f = f || {};
  var aktiv = (sektionen || []).filter(function(s) { return s.sichtbar; }).sort(function(a, b) { return a.sortierung - b.sortierung; });
  var body = '';
  var i = 0;
  while (i < aktiv.length) {
    if (aktiv[i].typ === 'leistung') {
      var group = [];
      while (i < aktiv.length && aktiv[i].typ === 'leistung') { group.push(aktiv[i]); i++; }
      body += renderLeistungen(group);
    } else { body += renderSektion(aktiv[i], f); i++; }
  }
  var ort = f.ort ? ' in ' + f.ort : '';
  var title = 'Schröder & Scholz – Reifenservice, Räderwechsel & Reifeneinlagerung' + ort;
  var desc = 'Schröder & Scholz – Ihr Reifenservice' + ort + ': schneller Räderwechsel, sichere Reifeneinlagerung, Reifen & Felgen sowie HU/TÜV-Service. Jetzt bequem online Termin buchen.';

  return '<!DOCTYPE html><html lang="de"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>' + esc(title) + '</title>' +
    '<meta name="description" content="' + esc(desc) + '">' +
    '<meta name="robots" content="index, follow">' +
    '<link rel="canonical" href="https://www.schroeder-scholz.de/">' +
    '<meta property="og:type" content="website"><meta property="og:title" content="' + esc(title) + '">' +
    '<meta property="og:description" content="' + esc(desc) + '"><meta property="og:url" content="https://www.schroeder-scholz.de/">' +
    '<meta property="og:image" content="https://www.schroeder-scholz.de/uploads/hero.jpg">' +
    '<script type="application/ld+json">' + jsonLd(f) + '</scr' + 'ipt>' +
    '<style>' + css() + '</style></head><body>' +
    '<header class="nav"><div class="nav-in">' +
    '<a href="/" class="wm">SCHRÖDER <span>&amp;</span> SCHOLZ</a>' +
    '<nav class="nav-links"><a href="#leistungen">Leistungen</a><a href="#oeffnungszeiten">Öffnungszeiten</a><a href="#kontakt">Kontakt</a>' +
    '<a class="btn-sm" href="/portal/">Kundenportal</a></nav>' +
    '</div></header>' +
    '<main>' + body + '</main>' +
    '<footer class="foot"><div class="inner">' +
    '<div class="foot-wm">SCHRÖDER <span>&amp;</span> SCHOLZ</div>' +
    '<div class="foot-sub">Reifenservice und Fahrzeugtechnik</div>' +
    '<div class="foot-links"><a href="/portal/">Kundenportal</a> · <a href="/portal/impressum.html">Impressum</a> · <a href="/portal/datenschutz.html">Datenschutz</a> · <a href="/portal/agb.html">AGB</a> · <a href="/portal/faq.html">FAQ</a></div>' +
    '</div></footer></body></html>';
}

function css() {
  return "*{margin:0;padding:0;box-sizing:border-box}" +
    "body{font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a1a;background:#fff;line-height:1.6}" +
    "a{color:inherit;text-decoration:none}" +
    ".inner{max-width:1100px;margin:0 auto;padding:0 24px}.narrow{max-width:760px}" +
    ".nav{position:sticky;top:0;z-index:50;background:#171717;border-bottom:3px solid #eab308}" +
    ".nav-in{max-width:1100px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}" +
    ".wm{font-weight:800;letter-spacing:.5px;color:#fff;font-size:20px}.wm span{color:#eab308}" +
    ".nav-links{display:flex;align-items:center;gap:20px;flex-wrap:wrap}.nav-links a{color:#e6e6e6;font-size:14px;font-weight:600}.nav-links a:hover{color:#eab308}" +
    ".btn-sm{background:#eab308;color:#171717!important;padding:8px 16px;border-radius:8px}" +
    ".hero{min-height:62vh;display:flex;align-items:center;background-size:cover;background-position:center;color:#fff}" +
    ".hero-in{max-width:1100px;margin:0 auto;padding:60px 24px}" +
    ".hero h1{font-size:clamp(30px,5vw,52px);font-weight:800;max-width:16em;line-height:1.15}" +
    ".hero p{font-size:clamp(16px,2.2vw,20px);margin:18px 0 28px;max-width:34em;color:#e6e6e6}" +
    ".btn{display:inline-block;background:#eab308;color:#171717;font-weight:700;padding:15px 32px;border-radius:10px;font-size:16px}" +
    ".btn-ghost{display:inline-block;border:1px solid #171717;color:#171717;font-weight:700;padding:11px 24px;border-radius:10px}" +
    ".sec{padding:64px 0}.sec.alt{background:#f6f7f9}.sec h2{font-size:clamp(24px,3.5vw,34px);font-weight:800;margin-bottom:28px}" +
    ".cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px}" +
    ".card{background:#fff;border:1px solid #e6e8ec;border-radius:14px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.04)}" +
    ".card-nr{font-size:13px;font-weight:800;color:#eab308;margin-bottom:8px}.card h3{font-size:19px;margin-bottom:8px}.card p{color:#555;font-size:15px}" +
    ".t-grid{display:grid;grid-template-columns:1fr 1fr;gap:36px;align-items:center}.t-text p{color:#444;font-size:16px}.t-img img{width:100%;border-radius:14px;display:block}" +
    ".oz{width:100%;border-collapse:collapse;font-size:16px}.oz td{padding:12px 0;border-bottom:1px solid #e6e8ec}.oz td:last-child{text-align:right;font-weight:700}" +
    "#kontakt p{margin-bottom:10px;font-size:16px}" +
    ".foot{background:#171717;color:#cfcfcf;padding:40px 0;text-align:center}.foot-wm{font-weight:800;color:#fff;font-size:18px}.foot-wm span{color:#eab308}" +
    ".foot-sub{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8b949e;margin:6px 0 16px}" +
    ".foot-links{font-size:13px}.foot-links a{color:#cfcfcf}.foot-links a:hover{color:#eab308}" +
    "@media(max-width:760px){.t-grid{grid-template-columns:1fr}.t-img{order:-1}.nav-links{gap:12px}.nav-links a:not(.btn-sm){display:none}.sec{padding:44px 0}}";
}

module.exports = { renderHomepage };
