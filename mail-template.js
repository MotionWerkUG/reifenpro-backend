'use strict';
// Gemeinsames, E-Mail-sicheres HTML-Template fuer Kundenportal-Mails (Schroeder & Scholz).
// Liegt auf dem Server unter src/lib/mail-template.js
// Marke im Portal IMMER "Schröder & Scholz" (Wortmarke schwarz/gelb), Impressum-Fusszeile aus Firmendaten.

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// opts: { titel, name, absaetze:[String], button:{text,url}, hinweis }
function portalMailHtml(einst, opts) {
  const e = einst || {};
  const o = opts || {};
  const adr = [e.strasse, [e.plz, e.ort].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const fuss = [adr, e.telefon ? 'Tel: ' + e.telefon : '', e.email || '', e.ust_id ? 'USt-IdNr. ' + e.ust_id : '']
    .filter(Boolean).map(esc).join('  ·  ');

  const absaetze = (o.absaetze || []).map(function (p) {
    return '<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#333333">' + p + '</p>';
  }).join('');

  const button = o.button ? (
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 18px"><tr>' +
    '<td style="border-radius:8px;background:#eab308">' +
    '<a href="' + esc(o.button.url) + '" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:#171717;text-decoration:none">' +
    esc(o.button.text) + '</a></td></tr></table>'
  ) : '';

  const hinweis = o.hinweis ? '<p style="margin:18px 0 0;font-size:12px;color:#999999;line-height:1.5">' + o.hinweis + '</p>' : '';

  return '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">' +
    // Kopf (Wortmarke)
    '<tr><td style="background:#171717;padding:26px 32px">' +
    '<div style="font-size:22px;font-weight:800;letter-spacing:.5px;color:#ffffff">SCHRÖDER <span style="color:#eab308">&amp;</span> SCHOLZ</div>' +
    '<div style="font-size:11px;color:#a3a3a3;margin-top:4px;letter-spacing:1.5px;text-transform:uppercase">Reifenservice und Fahrzeugtechnik</div>' +
    '</td></tr>' +
    '<tr><td style="height:4px;background:#eab308;font-size:0;line-height:0">&nbsp;</td></tr>' +
    // Inhalt
    '<tr><td style="padding:30px 32px 26px">' +
    (o.titel ? '<h1 style="margin:0 0 18px;font-size:19px;color:#171717">' + esc(o.titel) + '</h1>' : '') +
    (o.name ? '<p style="margin:0 0 14px;font-size:15px;color:#333333">Hallo ' + esc(o.name) + ',</p>' : '') +
    absaetze + button + hinweis +
    '<p style="margin:24px 0 0;font-size:15px;color:#333333">Mit freundlichen Grüßen<br><strong>Schröder &amp; Scholz</strong></p>' +
    '</td></tr>' +
    // Fusszeile (Impressum aus Firmendaten)
    '<tr><td style="background:#fafafa;border-top:1px solid #ececec;padding:16px 32px">' +
    '<p style="margin:0;font-size:11px;color:#999999;line-height:1.6">' + (fuss || 'Schröder &amp; Scholz') + '</p></td></tr>' +
    '</table></td></tr></table></body></html>';
}

module.exports = { portalMailHtml };
