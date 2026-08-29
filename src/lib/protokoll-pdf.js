'use strict';
// Erzeugt das Annahme-/Uebergabeprotokoll als PDF (Fotos + Checkliste + Unterschrift).
// Liegt auf dem Server unter src/lib/protokoll-pdf.js
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// Protokoll-Dateien (Fotos, Unterschriften, PDFs) sind unterschriebene Belege mit
// Aufbewahrungspflicht. Sie gehoeren ins aktive Projekt (Modell A) — der alte Pfad
// /var/www/reifenpro-backend/... ist der inaktive Vor-Umzug-Ordner und wird vom
// naechtlichen Backup nicht erfasst. Ueberschreibbar per PROTOKOLL_DIR.
const DATEI_DIR = process.env.PROTOKOLL_DIR ||
  path.join(__dirname, '..', '..', 'protokoll-dateien');

function fmtDatum(d) {
  return new Date(d || Date.now()).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtZeit(d) {
  return new Date(d || Date.now()).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// p = protokoll-Zeile, k = Kunde, f = Firmen-Einstellungen
async function erzeugeProtokollPdf(p, k, f) {
  const titel = p.typ === 'uebergabe' ? 'Übergabeprotokoll' : 'Annahmeprotokoll';
  const pfad = path.join(DATEI_DIR, 'protokoll-' + p.id + '.pdf');
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 45, bottom: 40, left: 50, right: 50 } });
      const stream = fs.createWriteStream(pfad);
      doc.pipe(stream);
      const B = '#1a3a6e';

      // Kopf
      doc.fillColor(B).fontSize(16).font('Helvetica-Bold').text(f.firmenname || 'Schröder & Scholz', 50, 45);
      doc.fillColor('#555').fontSize(8).font('Helvetica')
        .text([f.strasse, ((f.plz || '') + ' ' + (f.ort || '')).trim()].filter(Boolean).join(' · '), 50, 65)
        .text([f.telefon ? 'Tel. ' + f.telefon : '', f.email || ''].filter(Boolean).join(' · '), 50, 76);
      doc.fillColor('#888').fontSize(8).text(fmtDatum(p.erstellt_am) + ' ' + fmtZeit(p.erstellt_am) + ' Uhr', 400, 45, { width: 145, align: 'right' });
      doc.moveTo(50, 92).lineTo(545, 92).lineWidth(2).strokeColor(B).stroke();

      doc.fillColor(B).fontSize(14).font('Helvetica-Bold').text(titel, 50, 104);
      let y = 128;

      // Kunde / Fahrzeug
      const zeile = (label, wert, yy, x, w) => {
        doc.fillColor('#777').fontSize(7).font('Helvetica').text(label.toUpperCase(), x, yy);
        doc.fillColor('#111').fontSize(10).font('Helvetica-Bold').text(wert || '—', x, yy + 9, { width: w || 230 });
      };
      zeile('Kunde', ((k.vorname || '') + ' ' + (k.nachname || '')).trim() || k.firma || '—', y, 50);
      zeile('Kunden-Nr.', k.kunden_nr, y, 300);
      y += 32;
      zeile('Kennzeichen', p.kennzeichen, y, 50);
      zeile('km-Stand', p.km_stand != null ? String(p.km_stand) : '—', y, 300);
      y += 36;

      // Checkliste
      let cl = p.checkliste;
      if (typeof cl === 'string') { try { cl = JSON.parse(cl); } catch (e) { cl = []; } }
      if (Array.isArray(cl) && cl.length) {
        doc.fillColor(B).fontSize(9).font('Helvetica-Bold').text('Zustandsprüfung', 50, y);
        y += 14;
        cl.forEach((c) => {
          const ok = c.ok === true;
          doc.roundedRect(50, y - 1, 10, 10, 2).lineWidth(0.8).strokeColor(ok ? '#1a7f37' : '#c0392b').stroke();
          if (ok) doc.fillColor('#1a7f37').fontSize(8).font('Helvetica-Bold').text('x', 52.5, y);
          doc.fillColor('#111').fontSize(9).font('Helvetica').text(String(c.punkt || ''), 66, y, { width: 230 });
          doc.fillColor(ok ? '#1a7f37' : '#c0392b').fontSize(9).font('Helvetica-Bold').text(ok ? 'in Ordnung' : 'Beanstandung', 300, y, { width: 90 });
          if (c.bemerkung) doc.fillColor('#555').fontSize(8).font('Helvetica').text(String(c.bemerkung), 395, y, { width: 150 });
          y += 15;
        });
        y += 6;
      }

      // Maengel / Bemerkungen
      if (p.maengel) {
        doc.fillColor(B).fontSize(9).font('Helvetica-Bold').text('Bemerkungen / festgestellte Mängel', 50, y);
        y += 13;
        doc.fillColor('#111').fontSize(9).font('Helvetica').text(String(p.maengel), 50, y, { width: 495 });
        y = doc.y + 10;
      }

      // Fotos (bis 8, 2 pro Reihe, 4 pro Seite mit Umbruch)
      let fotos = p.fotos;
      if (typeof fotos === 'string') { try { fotos = JSON.parse(fotos); } catch (e) { fotos = []; } }
      fotos = (fotos || []).filter(Boolean).slice(0, 8);
      if (fotos.length) {
        if (y > 560) { doc.addPage(); y = 50; }
        doc.fillColor(B).fontSize(9).font('Helvetica-Bold').text('Fotodokumentation', 50, y);
        const bw = 240, bh = 180, gap = 10;
        let baseY = y + 14;
        fotos.forEach((datei, i) => {
          if (i > 0 && i % 4 === 0) { doc.addPage(); doc.fillColor(B).fontSize(9).font('Helvetica-Bold').text('Fotodokumentation (Fortsetzung)', 50, 45); baseY = 62; }
          const idx = i % 4, col = idx % 2, row = Math.floor(idx / 2);
          const bx = 50 + col * (bw + 15), by = baseY + row * (bh + gap);
          const fp = path.join(DATEI_DIR, String(datei));
          try { if (fs.existsSync(fp)) doc.image(fp, bx, by, { fit: [bw, bh], align: 'center', valign: 'center' }); } catch (e) { /* Bild defekt -> ueberspringen */ }
          doc.rect(bx, by, bw, bh).lineWidth(0.5).strokeColor('#ccc').stroke();
        });
        const lastCount = ((fotos.length - 1) % 4) + 1;
        y = baseY + Math.ceil(lastCount / 2) * (bh + gap) + 6;
      }

      // Unterschrift
      if (y > 640) { doc.addPage(); y = 50; }
      y = Math.max(y, 640);
      doc.fillColor('#555').fontSize(8).font('Helvetica')
        .text('Der Kunde bestätigt mit seiner Unterschrift den oben dokumentierten Zustand bei ' +
              (p.typ === 'uebergabe' ? 'Übergabe' : 'Annahme') + '.', 50, y, { width: 495 });
      y += 18;
      const sigPfad = p.unterschrift_datei ? path.join(DATEI_DIR, String(p.unterschrift_datei)) : null;
      if (sigPfad && fs.existsSync(sigPfad)) {
        try { doc.image(sigPfad, 50, y, { fit: [200, 45] }); } catch (e) { /* ignorieren */ }
      }
      doc.moveTo(50, y + 50).lineTo(260, y + 50).lineWidth(0.8).strokeColor('#333').stroke();
      doc.fillColor('#555').fontSize(7).text('Unterschrift Kunde' + (p.unterschrift_name ? ' (' + p.unterschrift_name + ')' : ''), 50, y + 54);
      doc.moveTo(320, y + 50).lineTo(530, y + 50).lineWidth(0.8).strokeColor('#333').stroke();
      doc.fillColor('#555').fontSize(7).text('Datum / Mitarbeiter', 320, y + 54);
      doc.fillColor('#111').fontSize(8).text(fmtDatum(p.erstellt_am), 320, y + 38);

      doc.fillColor('#999').fontSize(6.5).text('Protokoll-ID ' + p.id, 50, 800, { width: 495, align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(pfad));
      stream.on('error', reject);
    } catch (e) { reject(e); }
  });
}

module.exports = { erzeugeProtokollPdf, DATEI_DIR };
