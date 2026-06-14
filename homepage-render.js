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

function renderLeistungen(group) {
  var cards = group.map(function(s, i) {
    var nr = String(i + 1).padStart(2, '0');
    var img = s.bild_url ? '<div class="card-img"><img src="' + esc(s.bild_url) + '" alt="' + esc(s.headline || '') + '" loading="lazy"></div>' : '';
    return '<div class="card">' + img +
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
    '</div></footer>' + script() + '</body></html>';
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
    ".foot{background:#171717;color:#cfcfcf;padding:40px 0;text-align:center}.foot-wm{font-weight:800;color:#fff;font-size:18px}.foot-wm span{color:#eab308}" +
    ".foot-sub{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8b949e;margin:6px 0 16px}" +
    ".foot-links{font-size:13px}.foot-links a{color:#cfcfcf}.foot-links a:hover{color:#eab308}" +
    "@media(max-width:760px){.t-grid{grid-template-columns:1fr}.t-img{order:-1}.k-grid{grid-template-columns:1fr}.nav-links{gap:12px}.nav-links a:not(.btn-sm){display:none}.sec{padding:44px 0}}";
}

function script() {
  return "<scr" + "ipt>" +
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
    "</scr" + "ipt>";
}

module.exports = { renderHomepage };
