'use strict';
// PDF-Erzeugung fuer Rechnungen (pdfkit). Liegt auf dem Server unter src/lib/rechnung-pdf.js
// Briefkopf mit Wortmarke, GiroCode (EPC-QR) zum Scannen mit der Banking-App, eine Seite.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
let QRCode = null; try { QRCode = require('qrcode'); } catch (e) { /* optional */ }

// Ablageort der Rechnungs-PDFs (aufbewahrungspflichtig). Die Umlenkung ueber RECHNUNGEN_DIR
// greift AUSSCHLIESSLICH im Testbetrieb (NODE_ENV=test); produktiv ist der Projektordner
// 'rechnungen/' fest verdrahtet und durch eine gesetzte Umgebungsvariable nicht zu verschieben.
const PDF_DIR = (process.env.NODE_ENV === 'test' && process.env.RECHNUNGEN_DIR)
  ? process.env.RECHNUNGEN_DIR
  : path.join(__dirname, '..', '..', 'rechnungen');
const ACCENT = '#eab308';
const DARK = '#171717';

// Deutsche Betragsschreibweise inkl. Tausenderpunkt: 1.333,00 €
function eur(n) {
  return (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
// Prozentwert mit deutschem Zwischenraum: 19 %
function proz(n) { return (Number(n) || 0).toLocaleString('de-DE') + ' %'; }
function datumDE(d) {
  if (!d) return '';
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // 'YYYY-MM-DD' direkt zerlegen (keine Zeitzonen-Verschiebung)
  if (m) return m[3] + '.' + m[2] + '.' + m[1];
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  return String(dt.getDate()).padStart(2, '0') + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.' + dt.getFullYear();
}
function safeName(s) { return String(s || 'rechnung').replace(/[^A-Za-z0-9_-]/g, '_'); }
function mengeStr(p) {
  const m = (Number(p.menge) || 0).toString().replace('.', ',');
  return m + (p.einheit ? ' ' + p.einheit : '');
}

// EPC069-12 / GiroCode: von deutschen Banking-Apps scanbar zur SEPA-Ueberweisung
function epcPayload(a, rech) {
  if (!a || !a.iban) return null;
  const betrag = Number(rech.brutto_summe) || 0;
  if (betrag <= 0) return null;
  const name = String(a.firmenname || 'Schröder & Scholz').substring(0, 70);
  const iban = String(a.iban).replace(/\s/g, '');
  const bic = String(a.bic || '').replace(/\s/g, '');
  const zweck = ('Rechnung ' + (rech.rechnungsnr || '')).substring(0, 140);
  return ['BCD', '002', '1', 'SCT', bic, name, iban, 'EUR' + betrag.toFixed(2), '', '', zweck].join('\n');
}

async function erzeugeRechnungPdf(rech, positionen) {
  const a = rech.aussteller || {};
  const istStorno = !!rech.storno_von_id;
  // GiroCode-QR vorab erzeugen (nur echte Rechnung mit IBAN + Betrag)
  let qrBuf = null;
  if (!istStorno && QRCode) {
    const payload = epcPayload(a, rech);
    if (payload) { try { qrBuf = await QRCode.toBuffer(payload, { margin: 1, width: 250, errorCorrectionLevel: 'M' }); } catch (e) { qrBuf = null; } }
  }

  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
      const pfad = path.join(PDF_DIR, safeName(rech.rechnungsnr) + '.pdf');
      const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 40, left: 50, right: 50 } });
      const stream = fs.createWriteStream(pfad);
      doc.pipe(stream);

      const left = 50, rightEdge = 545, pageW = 595;
      const ausstellerAdr = [a.strasse, [a.plz, a.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');

      // ── Briefkopf: Wortmarke links, Aussteller-Adresse rechts ──
      const fn = String(a.firmenname || 'Schröder & Scholz');
      doc.font('Helvetica-Bold').fontSize(20);
      const teile = fn.split(' & ');
      if (teile.length === 2) {
        doc.fillColor(DARK).text(teile[0] + ' ', left, 48, { continued: true })
           .fillColor(ACCENT).text('& ', { continued: true })
           .fillColor(DARK).text(teile[1]);
      } else {
        doc.fillColor(DARK).text(fn, left, 48);
      }
      doc.rect(left, 73, 38, 3).fill(ACCENT);
      doc.font('Helvetica').fontSize(7).fillColor('#888').text('REIFENSERVICE UND FAHRZEUGTECHNIK', left, 79, { characterSpacing: 2 });
      // Aussteller-Adresse rechts
      doc.font('Helvetica').fontSize(8.5).fillColor('#555');
      const kopfRechts = [ausstellerAdr, a.telefon ? 'Tel: ' + a.telefon : '', a.email || ''].filter(Boolean).join('\n');
      if (kopfRechts) doc.text(kopfRechts, 320, 50, { width: rightEdge - 320, align: 'right' });

      // ── Empfaenger (links) ──
      doc.font('Helvetica').fontSize(7).fillColor('#999')
         .text((a.firmenname || '') + (ausstellerAdr ? ' · ' + ausstellerAdr : ''), left, 118);
      doc.fillColor('#000').font('Helvetica').fontSize(11);
      let ey = 130;
      if (rech.empfaenger_firma) { doc.text(rech.empfaenger_firma, left, ey); ey = doc.y; }
      const empfZeile = [rech.empfaenger_anrede, rech.empfaenger_name].filter(Boolean).join(' ');
      if (empfZeile) { doc.text(empfZeile, left, ey); ey = doc.y; }
      if (rech.empfaenger_strasse) doc.text(rech.empfaenger_strasse, left);
      doc.text([rech.empfaenger_plz, rech.empfaenger_ort].filter(Boolean).join(' '), left);

      // ── Meta-Box rechts (Nr/Datum) ──
      const mx = 360, mw = rightEdge - mx;
      doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK)
         .text(istStorno ? 'Stornorechnung' : 'Rechnung', mx, 118, { width: mw, align: 'right' });
      doc.font('Helvetica').fontSize(9.5).fillColor('#333');
      function meta(label, val) {
        const yy = doc.y;
        doc.fillColor('#888').text(label, mx, yy, { width: mw * 0.5, align: 'left' });
        doc.fillColor('#222').text(val, mx + mw * 0.5, yy, { width: mw * 0.5, align: 'right' });
      }
      doc.moveDown(0.6);
      meta('Rechnungs-Nr.', rech.rechnungsnr || '—');
      meta('Rechnungsdatum', datumDE(rech.rechnungsdatum));
      meta('Leistungsdatum', datumDE(rech.leistungsdatum || rech.rechnungsdatum));
      if (rech.faelligkeit && !istStorno) meta('Fällig bis', datumDE(rech.faelligkeit));

      // ── Positionstabelle ──
      let y = 210;
      // Spaltenraster: die Netto-Spalte muss auch negative Betraege (Storno, z. B. "-1.234,56 EUR")
      // einzeilig fassen, sonst bricht der Wert um.
      const col = { pos: left, bez: left + 28, menge: left + 232, ep: left + 300, mwst: left + 378, sum: left + 420 };
      const w = { bez: 200, menge: 60, ep: 74, mwst: 38, sum: rightEdge - (left + 420) };
      doc.rect(left, y - 4, rightEdge - left, 18).fill('#f4f4f5');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#444');
      doc.text('Pos', col.pos + 2, y, { width: 22 });
      doc.text('Bezeichnung', col.bez, y, { width: w.bez });
      doc.text('Menge', col.menge, y, { width: w.menge, align: 'right' });
      // Betrieb mit Endpreisen: Einzelpreis und Zeilensumme werden BRUTTO ausgewiesen. Sonst
      // stuende dort ein gerundeter Nettopreis, der mit der Menge multipliziert einen Cent von
      // der Zeilensumme abweichen kann (3 x 36,97 = 110,91 bei einer Zeile ueber 110,92).
      // Das nach Steuersaetzen aufgeschluesselte Entgelt steht in jedem Fall im Summenblock
      // darunter (§ 14 Abs. 4 Nr. 8 UStG).
      const bruttoSpalten = !!rech.brutto_darstellung;
      doc.text(bruttoSpalten ? 'Einzel brutto' : 'Einzel netto', col.ep, y, { width: w.ep, align: 'right' });
      doc.text('MwSt', col.mwst, y, { width: w.mwst, align: 'right' });
      doc.text(bruttoSpalten ? 'Brutto' : 'Netto', col.sum, y, { width: w.sum, align: 'right' });
      doc.y = y + 18;
      doc.font('Helvetica').fontSize(9.5).fillColor('#000');
      (positionen || []).forEach(function (p) {
        const ry = doc.y + 3;
        doc.fillColor('#000');
        doc.text(String(p.position), col.pos + 2, ry, { width: 22 });
        doc.text(p.bezeichnung || '', col.bez, ry, { width: w.bez });
        const afterBezY = doc.y;
        doc.text(mengeStr(p), col.menge, ry, { width: w.menge, align: 'right' });
        const menge = Number(p.menge) || 0;
        const zeileSumme = bruttoSpalten ? Number(p.zeilen_brutto) : Number(p.zeilen_netto);
        const einzel = bruttoSpalten
          ? (menge ? Math.round((Number(p.zeilen_brutto) / menge) * 100) / 100 : 0)
          : Number(p.einzelpreis_netto);
        doc.text(eur(einzel), col.ep, ry, { width: w.ep, align: 'right' });
        doc.text(proz(p.mwst_satz), col.mwst, ry, { width: w.mwst, align: 'right' });
        doc.text(eur(zeileSumme), col.sum, ry, { width: w.sum, align: 'right' });
        doc.y = Math.max(afterBezY, doc.y) + 4;
        doc.moveTo(left, doc.y).lineTo(rightEdge, doc.y).strokeColor('#eee').lineWidth(0.5).stroke();
      });

      // ── Summenblock rechts ──
      doc.moveDown(0.5);
      const sLabelX = 290, sValX = 460, sValW = rightEdge - 460;
      function sumLine(label, val, bold) {
        const yy = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(bold ? DARK : '#333');
        doc.text(label, sLabelX, yy, { width: sValX - sLabelX - 5, align: 'left' });
        doc.text(val, sValX, yy, { width: sValW, align: 'right' });
        doc.moveDown(bold ? 0.2 : 0.3);
      }
      sumLine('Nettobetrag', eur(rech.netto_summe));
      // Entgelt und Steuer je Steuersatz getrennt ausweisen (§ 14 Abs. 4 Nr. 8 UStG).
      // Je Steuersatz muessen BEIDE Angaben erscheinen: das darauf entfallende Entgelt und der Steuerbetrag.
      (rech.mwst_aufschluesselung || []).forEach(function (m) {
        sumLine((istStorno ? 'abzgl. ' : 'zzgl. ') + proz(m.satz) + ' MwSt auf ' + eur(m.netto), eur(m.mwst));
      });
      const gy = doc.y;
      doc.moveTo(sLabelX, gy).lineTo(rightEdge, gy).strokeColor(ACCENT).lineWidth(1).stroke();
      doc.moveDown(0.3);
      sumLine(istStorno ? 'Gutschriftbetrag' : 'Gesamtbetrag', eur(rech.brutto_summe), true);

      // ── Zahlungsbereich: Hinweis/Bank links, GiroCode rechts ──
      let py = Math.max(doc.y + 18, 640);
      if (istStorno) {
        // Der Bezug zur Originalrechnung muss auf dem Beleg selbst stehen (eindeutige Zuordnung der Korrektur).
        const bezug = rech.storno_von_nr
          ? 'Rechnung ' + rech.storno_von_nr + (rech.storno_von_datum ? ' vom ' + datumDE(rech.storno_von_datum) : '')
          : 'die ursprüngliche Rechnung';
        doc.font('Helvetica').fontSize(9).fillColor('#000')
           .text('Diese Stornorechnung hebt ' + bezug + ' vollständig auf.', left, py, { width: rightEdge - left });
      } else {
        const bankLines = [
          a.bank ? a.bank : null,
          a.iban ? 'IBAN: ' + a.iban : null,
          a.bic ? 'BIC: ' + a.bic : null
        ].filter(Boolean);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text('Zahlung', left, py);
        doc.font('Helvetica').fontSize(9).fillColor('#333');
        if (rech.faelligkeit) doc.text('Bitte überweisen Sie den Betrag bis ' + datumDE(rech.faelligkeit) + ' ohne Abzug.', left, doc.y + 2, { width: 300 });
        doc.text('Verwendungszweck: Rechnung ' + (rech.rechnungsnr || ''), left, doc.y + 2, { width: 300 });
        if (bankLines.length) { doc.moveDown(0.3); doc.fillColor('#222').text(bankLines.join('\n'), left, doc.y, { width: 300 }); }
        else { doc.moveDown(0.3); doc.fillColor('#999').text('Bankverbindung folgt (in Einstellungen hinterlegen).', left, doc.y, { width: 300 }); }

        if (qrBuf) {
          const qSize = 96, qx = rightEdge - qSize;
          doc.image(qrBuf, qx, py - 2, { width: qSize, height: qSize });
          doc.font('Helvetica').fontSize(7.5).fillColor('#666')
             .text('Mit der Banking-App scannen\n(GiroCode)', qx - 30, py + qSize, { width: qSize + 30, align: 'center' });
        }
      }

      // ── Fusszeile mit Pflichtangaben (§ 14 UStG) – eine Seite garantiert ──
      const fuss = [
        a.firmenname, a.rechtsform,
        a.inhaber ? 'Inhaber: ' + a.inhaber : null,
        a.handelsreg_nr ? 'HRB ' + a.handelsreg_nr : null,
        a.registergericht,
        a.steuernummer ? 'Steuernr. ' + a.steuernummer : null,
        a.ust_id ? 'USt-IdNr. ' + a.ust_id : null
      ].filter(Boolean).join('  ·  ');
      doc.page.margins.bottom = 0; // verhindert, dass die Fusszeile eine zweite Seite ausloest
      doc.moveTo(left, 800).lineTo(rightEdge, 800).strokeColor('#ddd').lineWidth(0.5).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor('#666')
         .text(fuss || (a.firmenname || ''), left, 806, { width: rightEdge - left, align: 'center', lineBreak: false });

      doc.end();
      stream.on('finish', function () { resolve(pfad); });
      stream.on('error', reject);
    } catch (err) { reject(err); }
  });
}

// epcPayload wird mit exportiert, damit der GiroCode-Inhalt automatisiert pruefbar ist.
module.exports = { erzeugeRechnungPdf, PDF_DIR, epcPayload };
