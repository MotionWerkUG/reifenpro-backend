'use strict';
// Oeffentlicher QR-Code-Generator (liefert SVG). Der QR enthaelt nur eine Ziel-URL,
// keine Daten -> unbedenklich oeffentlich. Liegt auf dem Server unter src/routes/qr.js.
const router = require('express').Router();
const QRCode = require('qrcode');

router.get('/', async (req, res) => {
  try {
    const text = String(req.query.text || '').slice(0, 512);
    if (!text) return res.status(400).send('Parameter text erforderlich.');
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch (e) {
    res.status(500).send('QR-Fehler');
  }
});

module.exports = router;
