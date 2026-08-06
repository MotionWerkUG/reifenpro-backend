'use strict';
// Zentrale Bildverarbeitung: schneidet jedes Bild verlustfrei auf das passende
// Format zu (kein Verzerren) und komprimiert es fuer schnelles Laden (SEO).
// Liegt auf dem Server unter src/lib/bildverarbeitung.js
const sharp = require('sharp');

// Zielformate je Einsatzort. cover = Bild fuellt den Rahmen, ueberstehendes
// wird mittig beschnitten -> passt IMMER, egal welches Hochformat/Querformat.
const FORMATE = {
  hero:   { w: 1600, h: 760 },   // breites Kopfbild (ca. 21:10)
  inhalt: { w: 900,  h: 675 }    // Leistungs-/Textbilder (4:3)
};

async function verarbeite(inputBuffer, format) {
  const z = FORMATE[format] || FORMATE.inhalt;
  return sharp(inputBuffer)
    .rotate()                                  // EXIF-Ausrichtung beachten (Handyfotos)
    .resize(z.w, z.h, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

module.exports = { verarbeite, FORMATE };
