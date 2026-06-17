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
    description: 'Reifenservice und Fahrzeugtechnik: Räderwechsel, Reifeneinlagerung, Reifen & Felgen, Fahrwerkstechnik und Bremsenservice.',
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
  var cta = '<a class="akt-cta" href="' + esc(link) + '">Jetzt Termin buchen</a>';
  var inner = '<span class="akt-text">' + esc(f.aktion_text) + '</span>' + code + cta;
  if (pos === 'leiste') return '<div class="akt-leiste">' + inner + '</div>';
  var seite = pos === 'ecke-links' ? ' links' : ' rechts';
  return '<div class="akt-ecke' + seite + '"><button class="akt-x" onclick="this.parentNode.remove()" aria-label="schließen">&times;</button>' + inner + '</div>';
}

// CTA-Abschnitt, der zur mehrstufigen Buchungsseite /termin/ fuehrt
function buchungHtml(f) {
  var titel = f.buchung_titel || 'Online Termin buchen';
  var text = f.buchung_text || 'In wenigen Schritten zum Wunschtermin: Leistung wählen, Zusatzleistungen ergänzen, freie Zeit aussuchen – Sie erhalten sofort eine Bestätigung per E-Mail.';
  return '<section class="sec buchung" id="termin-buchen"><div class="inner" style="text-align:center">' +
    '<h2 style="color:#fff">' + esc(titel) + '</h2>' +
    '<p class="bk-intro" style="margin:0 auto 24px">' + esc(text) + '</p>' +
    '<a class="btn" href="/termin/">Jetzt Termin buchen</a>' +
    '</div></section>';
}

function renderLeistungen(group) {
  var cards = group.map(function(s, i) {
    var nr = String(i + 1).padStart(2, '0');
    var img = s.bild_url ? '<div class="card-img"><img src="' + esc(s.bild_url) + '" alt="' + esc(s.headline || '') + '" loading="lazy"></div>' : '';
    return '<div class="card" data-sektion-id="' + esc(s.id) + '">' + img +
      '<div class="card-body">' +
      '<div class="card-nr">' + nr + '</div>' +
      '<h3>' + esc(s.headline || '') + '</h3>' +
      '<p>' + nl2br(s.inhalt || '') + '</p>' +
      '</div></div>';
  }).join('');
  return '<section class="sec" id="leistungen"><div class="inner">' +
    '<h2>Unsere Leistungen</h2><div class="cards">' + cards + '</div></div></section>';
}

function renderSektion(s, f) {
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
    var rows = oeffnungszeilen(f).map(function(r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') || '<tr><td colspan="2">Bitte erfragen Sie unsere Öffnungszeiten.</td></tr>';
    return '<section class="sec alt" id="oeffnungszeiten"><div class="inner narrow"><h2>' + esc(s.headline || 'Öffnungszeiten') + '</h2>' +
      '<table class="oz">' + rows + '</table></div></section>';
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
      (f.telefon ? '<p>Telefon: <a href="tel:' + esc(f.telefon) + '">' + esc(f.telefon) + '</a></p>' : '') +
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
      '<div class="kf-ok" id="kf-ok">Vielen Dank! Ihre Anfrage wurde gesendet. Wir melden uns zeitnah.</div>' +
      '<div class="kf-err" id="kf-err"></div>' +
      '<input type="text" id="kf-name" placeholder="Name" required>' +
      '<input type="email" id="kf-email" placeholder="E-Mail" required>' +
      '<input type="tel" id="kf-telefon" placeholder="Telefon (optional)">' +
      '<textarea id="kf-nachricht" placeholder="Ihre Nachricht" required></textarea>' +
      '<label class="kf-check"><input type="checkbox" id="kf-dsgvo" required> <span>Ich habe die <a href="/portal/datenschutz.html" target="_blank" rel="noopener">Datenschutzerklärung</a> gelesen und bin mit der Verarbeitung meiner Angaben zur Bearbeitung der Anfrage einverstanden.</span></label>' +
      '<input type="text" id="kf-hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">' +
      '<button type="submit" class="btn">Anfrage senden</button>' +
      '</form>';
    return '<section class="sec" id="kontakt"><div class="inner"><h2>' + esc(s.headline || 'Kontakt & Anfahrt') + '</h2>' +
      '<div class="k-grid"><div class="k-left">' + info + map + '</div>' + form + '</div></div></section>';
  }
  // text
  var img = s.bild_url ? '<div class="t-img"><img src="' + esc(s.bild_url) + '" alt="' + esc(s.headline || '') + '" loading="lazy"></div>' : '';
  return '<section class="sec" data-sektion-id="' + esc(s.id) + '"><div class="inner t-grid">' +
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
  // Online-Terminbuchung fuer Gaeste (standardmaessig an, im CMS steuerbar)
  if (f.buchung_aktiv !== false) {
    var bh = buchungHtml(f);
    if (body.indexOf('<section class="sec" id="kontakt">') !== -1) body = body.replace('<section class="sec" id="kontakt">', bh + '<section class="sec" id="kontakt">');
    else body += bh;
  }
  var ort = f.ort ? ' in ' + f.ort : '';
  var title = 'Schröder & Scholz – Reifenservice, Räderwechsel & Reifeneinlagerung' + ort;
  var desc = 'Schröder & Scholz – Ihr Reifenservice' + ort + ': schneller Räderwechsel, sichere Reifeneinlagerung, Reifen & Felgen sowie Fahrwerkstechnik und Bremsenservice. Jetzt bequem online Termin buchen.';

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
    bannerHtml(f) +
    '<header class="nav"><div class="nav-in">' +
    '<a href="/" class="wm" aria-label="Schröder & Scholz">' + logoSvg(212, 38) + '</a>' +
    '<nav class="nav-links"><a href="#leistungen">Leistungen</a><a href="/termin/">Termin buchen</a><a href="#oeffnungszeiten">Öffnungszeiten</a><a href="#kontakt">Kontakt</a>' +
    '<a class="btn-sm" href="/portal/">Kundenportal</a></nav>' +
    '</div></header>' +
    '<main>' + body + '</main>' +
    '<footer class="foot"><div class="inner">' +
    '<div class="foot-logo">' + logoSvg(252, 45) + '</div>' +
    '<div class="foot-links"><a href="/portal/">Kundenportal</a> · <a href="/portal/impressum.html">Impressum</a> · <a href="/portal/datenschutz.html">Datenschutz</a> · <a href="/portal/agb.html">AGB</a> · <a href="/portal/faq.html">FAQ</a></div>' +
    '</div></footer>' + script() + '</body></html>';
}

function css() {
  return "*{margin:0;padding:0;box-sizing:border-box}" +
    "body{font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a1a;background:#fff;line-height:1.6}" +
    "a{color:inherit;text-decoration:none}" +
    ".inner{max-width:1100px;margin:0 auto;padding:0 24px}.narrow{max-width:760px}" +
    ".akt-leiste{background:#eab308;color:#171717;display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;padding:11px 18px;font-weight:600;font-size:14.5px;text-align:center}" +
    ".akt-code{background:#171717;color:#eab308;padding:3px 12px;border-radius:6px;font-weight:800;letter-spacing:1.5px}" +
    ".akt-cta{background:#171717;color:#fff;padding:7px 16px;border-radius:8px;font-weight:700;white-space:nowrap}" +
    ".akt-ecke{position:fixed;top:88px;z-index:60;max-width:280px;background:#171717;color:#fff;border:2px solid #eab308;border-radius:14px;padding:18px 18px 16px;box-shadow:0 12px 30px rgba(0,0,0,.35)}" +
    ".akt-ecke.links{left:18px}.akt-ecke.rechts{right:18px}" +
    ".akt-ecke .akt-text{display:block;font-weight:600;font-size:15px;margin-bottom:12px;line-height:1.45}" +
    ".akt-ecke .akt-code{display:inline-block;margin-bottom:12px}.akt-ecke .akt-cta{display:inline-block}" +
    ".akt-x{position:absolute;top:6px;right:10px;background:none;border:none;color:#cfcfcf;font-size:20px;line-height:1;cursor:pointer}" +
    "@media(max-width:600px){.akt-ecke{left:12px;right:12px;max-width:none;top:auto;bottom:12px}}" +
    ".nav{position:sticky;top:0;z-index:50;background:#171717;border-bottom:3px solid #eab308}" +
    ".nav-in{max-width:1100px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}" +
    ".wm{display:inline-flex;align-items:center}.wm svg{height:38px;width:auto}" +
    ".nav-links{display:flex;align-items:center;gap:20px;flex-wrap:wrap}.nav-links a{color:#e6e6e6;font-size:14px;font-weight:600}.nav-links a:hover{color:#eab308}" +
    ".btn-sm{background:#eab308;color:#171717!important;padding:8px 16px;border-radius:8px}" +
    ".hero{min-height:62vh;display:flex;align-items:center;background-size:cover;background-position:center;color:#fff}" +
    ".hero-in{max-width:1100px;margin:0 auto;padding:60px 24px}" +
    ".hero h1{font-size:clamp(30px,5vw,52px);font-weight:800;max-width:16em;line-height:1.15}" +
    ".hero p{font-size:clamp(16px,2.2vw,20px);margin:18px 0 28px;max-width:34em;color:#e6e6e6}" +
    ".btn{display:inline-block;background:#eab308;color:#171717;font-weight:700;padding:15px 32px;border-radius:10px;font-size:16px}" +
    ".btn-ghost{display:inline-block;border:1px solid #171717;color:#171717;font-weight:700;padding:11px 24px;border-radius:10px}" +
    ".sec{padding:64px 0}.sec.alt{background:#f6f7f9}.sec h2{font-size:clamp(24px,3.5vw,34px);font-weight:800;margin-bottom:28px}" +
    ".cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}" +
    ".card{background:#fff;border:1px solid #e6e8ec;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);display:flex;flex-direction:column}" +
    ".card-img{aspect-ratio:4/3;background:#eef0f3}.card-img img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".card-body{padding:22px 24px}" +
    ".card-nr{font-size:13px;font-weight:800;color:#eab308;margin-bottom:8px}.card h3{font-size:19px;margin-bottom:8px}.card p{color:#555;font-size:15px}" +
    ".t-grid{display:grid;grid-template-columns:1fr 1fr;gap:36px;align-items:center}.t-text p{color:#444;font-size:16px}" +
    ".t-img{aspect-ratio:4/3;border-radius:14px;overflow:hidden;background:#eef0f3}.t-img img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".oz{width:100%;border-collapse:collapse;font-size:16px}.oz td{padding:12px 0;border-bottom:1px solid #e6e8ec}.oz td:last-child{text-align:right;font-weight:700}" +
    "#kontakt p{margin-bottom:10px;font-size:16px}" +
    ".k-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}" +
    ".k-card{background:#fff;border:1px solid #e6e8ec;border-radius:14px;padding:24px;margin-bottom:20px}.k-card h3{font-size:20px;margin-bottom:10px}" +
    ".k-map{aspect-ratio:16/10;border-radius:14px;overflow:hidden;border:1px solid #e6e8ec;background:#eef0f3}.k-map iframe{width:100%;height:100%;border:0;display:block}" +
    ".k-map-ph{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px}.k-map-ph p{font-weight:700;color:#444;margin:0}" +
    ".k-map-note{font-size:12px;color:#777;max-width:340px;line-height:1.5}.k-map-note a{color:#171717;text-decoration:underline}" +
    ".k-form{background:#fff;border:1px solid #e6e8ec;border-radius:14px;padding:24px;display:flex;flex-direction:column;gap:12px}.k-form h3{font-size:20px;margin-bottom:4px}" +
    ".k-form input,.k-form textarea{width:100%;border:1px solid #d5d9e0;border-radius:8px;padding:12px 14px;font-size:15px;font-family:inherit;background:#fff;color:#1a1a1a}" +
    ".k-form input:focus,.k-form textarea:focus{outline:none;border-color:#eab308}.k-form textarea{min-height:130px;resize:vertical}.k-form .btn{border:none;cursor:pointer;font-family:inherit;align-self:flex-start}" +
    ".kf-check{font-size:13px;color:#555;display:flex;gap:8px;align-items:flex-start;line-height:1.5}.kf-check input{width:auto;margin-top:3px}.kf-check a{color:#171717;text-decoration:underline}" +
    ".kf-ok{display:none;background:#e7f7ee;color:#0f6b3e;border:1px solid #b7e4cd;border-radius:8px;padding:12px 14px;font-size:14px}" +
    ".kf-err{display:none;background:#fdecea;color:#b3261e;border:1px solid #f5c6c2;border-radius:8px;padding:12px 14px;font-size:14px}" +
    ".buchung{background:#171717}.buchung h2{color:#fff}.bk-intro{color:#cfcfcf;max-width:46em;margin:-10px 0 22px;font-size:16px}" +
    ".bk-card{background:#fff;border-radius:16px;padding:26px;max-width:760px;box-shadow:0 18px 40px rgba(0,0,0,.35)}" +
    ".bk-card label{display:block;font-size:12px;font-weight:700;color:#555;margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px}" +
    ".bk-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}" +
    ".bk-card input,.bk-card select{width:100%;border:1px solid #d5d9e0;border-radius:9px;padding:12px 13px;font-size:15px;font-family:inherit;background:#fff;color:#1a1a1a}" +
    ".bk-card input:focus,.bk-card select:focus{outline:none;border-color:#eab308}" +
    ".bk-kz{display:flex;gap:5px;align-items:center}.bk-kz span{color:#999}.bk-kz input{text-align:center;font-family:monospace;text-transform:uppercase;padding:12px 4px}" +
    ".bk-kz input:nth-child(1){flex:0 0 58px}.bk-kz input:nth-child(3){flex:0 0 46px}.bk-kz input:nth-child(5){flex:0 0 52px}.bk-kz input:nth-child(6){flex:0 0 40px}" +
    ".bk-slots{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.bk-slot{border:1px solid #d5d9e0;background:#fff;border-radius:8px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer;color:#1a1a1a}" +
    ".bk-slot:hover{border-color:#eab308}.bk-slot.on{background:#eab308;border-color:#eab308;color:#171717}" +
    ".bk-info{font-size:13px;color:#888;margin-top:8px}" +
    ".bk-check{display:flex;gap:9px;align-items:flex-start;font-size:13px;color:#555;text-transform:none;letter-spacing:0;font-weight:400;margin:16px 0 4px;line-height:1.5}.bk-check input{width:auto;margin-top:3px}.bk-check a{color:#171717;text-decoration:underline}" +
    ".bk-card .btn{border:none;cursor:pointer;font-family:inherit;margin-top:14px;width:100%;justify-content:center}" +
    ".bk-ok{display:none;background:#e7f7ee;color:#0f6b3e;border:1px solid #b7e4cd;border-radius:9px;padding:13px 15px;font-size:14px;margin-top:12px}" +
    ".bk-err{display:none;background:#fdecea;color:#b3261e;border:1px solid #f5c6c2;border-radius:9px;padding:13px 15px;font-size:14px;margin-top:12px}" +
    ".foot{background:#171717;color:#cfcfcf;padding:40px 0;text-align:center}.foot-logo{display:flex;justify-content:center;margin-bottom:18px}.foot-logo svg{max-width:90%;height:auto}" +
    ".foot-links{font-size:13px}.foot-links a{color:#cfcfcf}.foot-links a:hover{color:#eab308}" +
    "@media(max-width:760px){.t-grid{grid-template-columns:1fr}.t-img{order:-1}.k-grid{grid-template-columns:1fr}.bk-grid{grid-template-columns:1fr}.bk-card{padding:18px}.nav-links{gap:12px}.nav-links a:not(.btn-sm){display:none}.sec{padding:44px 0}.wm svg{height:30px}}";
}

function script() {
  return "<scr" + "ipt>" +
    // ── Visueller Editor (nur bei ?editor=1, im CMS-iframe) ──
    "(function(){if(location.search.indexOf('editor=1')===-1)return;" +
    "var st=document.createElement('style');st.textContent='[data-sektion-id]{position:relative}[data-sektion-id]:hover{outline:3px dashed #eab308;outline-offset:-3px}.cms-eb{position:absolute;top:10px;right:10px;z-index:9999;background:#eab308;color:#171717;border:none;border-radius:8px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.35);font-family:-apple-system,Arial,sans-serif}.cms-eb:hover{background:#fff}';document.head.appendChild(st);" +
    "function add(el){var b=document.createElement('button');b.className='cms-eb';b.type='button';b.textContent='\\u270E Bearbeiten';b.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();parent.postMessage({type:'cms-edit',id:el.getAttribute('data-sektion-id')},'*');});el.appendChild(b);}" +
    "var els=document.querySelectorAll('[data-sektion-id]');for(var i=0;i<els.length;i++)add(els[i]);" +
    "document.addEventListener('click',function(ev){var a=ev.target.closest&&ev.target.closest('a');if(a)ev.preventDefault();},true);" +
    "})();" +
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
    "if(!d.datenschutz){er.textContent='Bitte stimmen Sie der Datenschutzerklärung zu.';er.style.display='block';return false;}" +
    "var b=document.getElementById('bk-submit');b.disabled=true;var bt=b.textContent;b.textContent='Wird gebucht …';" +
    "fetch('/api/gast/termin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})" +
    ".then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Buchung fehlgeschlagen.');return j;});})" +
    ".then(function(j){ev.target.reset();bkSel=null;document.getElementById('bk-slots-wrap').style.display='none';ok.innerHTML='Vielen Dank! Ihr Termin am '+String(j.datum||'').split('-').reverse().join('.')+' um '+(j.uhrzeit_von||'')+' Uhr ist bestätigt. Sie erhalten eine Bestätigung per E-Mail.';ok.style.display='block';ok.scrollIntoView({behavior:'smooth',block:'center'});})" +
    ".catch(function(x){er.textContent=x.message;er.style.display='block';})" +
    ".then(function(){b.disabled=false;b.textContent=bt;});return false;}" +
    "</scr" + "ipt>";
}

module.exports = { renderHomepage };
