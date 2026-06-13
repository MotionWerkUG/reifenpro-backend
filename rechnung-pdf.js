'use strict';
// PDF-Erzeugung fuer Rechnungen (pdfkit). Liegt auf dem Server unter src/lib/rechnung-pdf.js
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// Ablageort der revisionssicheren PDFs
const PDF_DIR = path.join(__dirname, '..', '..', 'rechnungen');

function eur(n) {
  return (Number(n) || 0).toFixed(2).replace('.', ',') + ' €';
}
function datumDE(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return String(dt.getDate()).padStart(2, '0') + '.' +
         String(dt.getMonth() + 1).padStart(2, '0') + '.' + dt.getFullYear();
}
function safeName(s) { return String(s || 'rechnung').replace(/[^A-Za-z0-9_-]/g, '_'); }
function mengeStr(p) {
  const m = (Number(p.menge) || 0).toString().replace('.', ',');
  return m + (p.einheit ? ' ' + p.einheit : '');
}

// rech: Rechnungs-Datensatz inkl. aussteller (Objekt) und empfaenger_*-Feldern
// positionen: Zeilen mit zeilen_netto etc.
function erzeugeRechnungPdf(rech, positionen) {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
      const a = rech.aussteller || {};
      const istStorno = !!rech.storno_von_id;
      const pfad = path.join(PDF_DIR, safeName(rech.rechnungsnr) + '.pdf');
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(pfad);
      doc.pipe(stream);

      const left = 50;
      const rightEdge = 545; // 595 - 50
      const ausstellerAdr = [a.strasse, [a.plz, a.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');

      // Aussteller-Kopf
      doc.fillColor('#000').font('Helvetica-Bold').fontSize(16).text(a.firmenname || 'Firma', left, 50);
      doc.font('Helvetica').fontSize(9).fillColor('#555');
      if (ausstellerAdr) doc.text(ausstellerAdr);
      if (a.telefon) doc.text('Tel: ' + a.telefon);
      if (a.email) doc.text(a.email);

      // Empfaenger
      doc.moveDown(2);
      doc.fontSize(8).fillColor('#888')
         .text((a.firmenname || '') + (ausstellerAdr ? ' · ' + ausstellerAdr : ''));
      doc.fillColor('#000').font('Helvetica').fontSize(11);
      if (rech.empfaenger_firma) doc.text(rech.empfaenger_firma);
      doc.text(rech.empfaenger_name || '');
      if (rech.empfaenger_strasse) doc.text(rech.empfaenger_strasse);
      doc.text([rech.empfaenger_plz, rech.empfaenger_ort].filter(Boolean).join(' '));

      // Titel + Metadaten
      doc.moveDown(2);
      doc.font('Helvetica-Bold').fontSize(15).text(istStorno ? 'Stornorechnung' : 'Rechnung');
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(10);
      doc.text('Rechnungsnummer: ' + (rech.rechnungsnr || ''));
      doc.text('Rechnungsdatum: ' + datumDE(rech.rechnungsdatum));
      doc.text('Leistungsdatum: ' + datumDE(rech.leistungsdatum || rech.rechnungsdatum));

      // Positionstabelle
      doc.moveDown(1.2);
      const col = { pos: left, bez: left + 30, menge: left + 250, ep: left + 320, mwst: left + 410, sum: left + 460 };
      const colEnd = { bez: 250, menge: 60, ep: 80, mwst: 40, sum: rightEdge - (left + 460) };
      let y = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
      doc.text('Pos', col.pos, y, { width: 25 });
      doc.text('Bezeichnung', col.bez, y, { width: colEnd.bez });
      doc.text('Menge', col.menge, y, { width: colEnd.menge, align: 'right' });
      doc.text('Einzel netto', col.ep, y, { width: colEnd.ep, align: 'right' });
      doc.text('MwSt', col.mwst, y, { width: colEnd.mwst, align: 'right' });
      doc.text('Netto', col.sum, y, { width: colEnd.sum, align: 'right' });
      doc.moveDown(0.3);
      doc.moveTo(left, doc.y).lineTo(rightEdge, doc.y).strokeColor('#aaa').lineWidth(0.5).stroke();
      doc.moveDown(0.3);

      doc.font('Helvetica').fontSize(9).fillColor('#000');
      positionen.forEach(function (p) {
        const ry = doc.y;
        doc.text(String(p.position), col.pos, ry, { width: 25 });
        doc.text(p.bezeichnung || '', col.bez, ry, { width: colEnd.bez });
        const afterBezY = doc.y; // Bezeichnung kann umbrechen
        doc.text(mengeStr(p), col.menge, ry, { width: colEnd.menge, align: 'right' });
        doc.text(eur(p.einzelpreis_netto), col.ep, ry, { width: colEnd.ep, align: 'right' });
        doc.text((Number(p.mwst_satz) || 0) + '%', col.mwst, ry, { width: colEnd.mwst, align: 'right' });
        doc.text(eur(p.zeilen_netto), col.sum, ry, { width: colEnd.sum, align: 'right' });
        doc.y = Math.max(afterBezY, doc.y);
        doc.moveDown(0.4);
      });
      doc.moveTo(left, doc.y).lineTo(rightEdge, doc.y).strokeColor('#aaa').lineWidth(0.5).stroke();
      doc.moveDown(0.6);

      // Summenblock (rechts)
      const sumLabelX = 360, sumValX = 470, sumValW = rightEdge - 470;
      function sumLine(label, val, bold) {
        const yy = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
        doc.text(label, sumLabelX, yy, { width: 105, align: 'left' });
        doc.text(val, sumValX, yy, { width: sumValW, align: 'right' });
        doc.moveDown(0.25);
      }
      sumLine('Nettobetrag', eur(rech.netto_summe));
      (rech.mwst_aufschluesselung || []).forEach(function (m) {
        sumLine('zzgl. ' + (Number(m.satz) || 0) + '% MwSt', eur(m.mwst));
      });
      sumLine(istStorno ? 'Gesamtbetrag (Gutschrift)' : 'Gesamtbetrag', eur(rech.brutto_summe), true);

      // Zahlungshinweis / Bankverbindung
      doc.moveDown(1.4);
      doc.font('Helvetica').fontSize(9).fillColor('#000');
      if (istStorno) {
        doc.text('Diese Stornorechnung hebt die urspruengliche Rechnung vollstaendig auf.', left);
      } else {
        if (rech.faelligkeit) doc.text('Zahlbar bis ' + datumDE(rech.faelligkeit) + ' ohne Abzug.', left);
        const bank = [a.bank, a.iban ? 'IBAN ' + a.iban : null, a.bic ? 'BIC ' + a.bic : null].filter(Boolean).join('   ·   ');
        if (bank) { doc.moveDown(0.3); doc.text('Bankverbindung: ' + bank, left); }
      }

      // Fusszeile mit Pflichtangaben (§ 14 UStG)
      const fuss = [
        a.firmenname, a.rechtsform,
        a.inhaber ? 'Inhaber: ' + a.inhaber : null,
        a.handelsreg_nr ? 'HRB ' + a.handelsreg_nr : null,
        a.registergericht,
        a.steuernummer ? 'Steuernr. ' + a.steuernummer : null,
        a.ust_id ? 'USt-IdNr. ' + a.ust_id : null
      ].filter(Boolean).join('  ·  ');
      doc.font('Helvetica').fontSize(7.5).fillColor('#666')
         .text(fuss, left, 795, { width: rightEdge - left, align: 'center' });

      doc.end();
      stream.on('finish', function () { resolve(pfad); });
      stream.on('error', reject);
    } catch (err) { reject(err); }
  });
}

module.exports = { erzeugeRechnungPdf, PDF_DIR };
