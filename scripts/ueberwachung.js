// Ausfall-Ueberwachung fuer ReifenPro. Laeuft per Cron alle 5 Minuten.
//
// WARUM ES DAS GIBT: Auf diesem Server wurde bisher nur ein anderes Projekt ueberwacht.
// ReifenPro nimmt seit dem Livegang echte Buchungen an, ein Flyer mit Gutschein ist verteilt --
// faellt die Buchung an einem Samstagmorgen aus, erfaehrt es der Betrieb vom ersten Kunden, der
// anruft. Oder gar nicht, weil der Kunde einfach woanders hinfaehrt.
//
// WARUM NICHT NUR "ANTWORTET DIE SEITE": Ein HTTP 200 sagt wenig. Die gefaehrlicheren Ausfaelle
// sind die, bei denen die Seite laedt und trotzdem niemand buchen kann -- Datenbank weg,
// Leistungen leer, keine freien Zeiten. Deshalb wird hier der GESCHAEFTSVORGANG geprueft:
// Gibt es buchbare Leistungen, und gibt es freie Termine?
//
// GRENZE, die man kennen muss: Faellt der ganze Server aus, kann diese Pruefung nicht mehr
// mailen -- sie laeuft ja auf demselben Rechner. Fuer eine lueckenlose Ueberwachung braucht es
// zusaetzlich einen Dienst von aussen. Diese hier faengt den haeufigeren Fall ab: Der Server
// laeuft, die Anwendung nicht.
require('dotenv').config({ path: '/home/deploy/projekte/reifenpro/.env' });
const https = require('https');
const fs = require('fs');
const nodemailer = require('nodemailer');

const BASIS = 'https://www.schroeder-scholz.de';
const ADMIN = 'https://admin.schroeder-scholz.de';
const STAND = '/var/backups/reifenpro/.ueberwachung_stand';
const AN = process.env.BACKUP_MAIL_TO || process.env.EMAIL_FROM_ADDRESS;

function hole(url) {
  return new Promise((fertig) => {
    const req = https.get(url, { timeout: 12000 }, (r) => {
      let text = '';
      r.on('data', (d) => { if (text.length < 20000) text += d; });
      r.on('end', () => fertig({ code: r.statusCode, text }));
    });
    req.on('timeout', () => { req.destroy(); fertig({ code: 0, text: '' }); });
    req.on('error', () => fertig({ code: 0, text: '' }));
  });
}

// Naechste Werktage, an denen gebucht werden koennte. Mehrere, weil einzelne Tage
// Feiertag oder Betriebsurlaub sein duerfen -- das ist kein Ausfall.
function pruefTage(anzahl) {
  const tage = [];
  const d = new Date(); d.setHours(12, 0, 0, 0);
  while (tage.length < anzahl) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0) continue;                       // Sonntag ist regulaer zu
    tage.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  }
  return tage;
}

async function pruefe() {
  const fehler = [];

  for (const [name, url] of [['Startseite', BASIS + '/'], ['Buchungsseite', BASIS + '/termin/'],
                             ['Kundenportal', BASIS + '/portal/'], ['Adminbereich', ADMIN + '/']]) {
    const r = await hole(url);
    if (r.code < 200 || r.code >= 400) fehler.push(name + ' antwortet mit ' + (r.code || 'gar nicht'));
  }

  // Der eigentliche Test: Kann ein Kunde buchen?
  const l = await hole(BASIS + '/api/gast/leistungen');
  let haupt = [];
  try { haupt = (JSON.parse(l.text).haupt) || []; } catch (e) { /* faellt unten auf */ }
  if (!haupt.length) {
    fehler.push('Es werden keine buchbaren Leistungen ausgeliefert (Datenbank oder Konfiguration)');
  } else {
    // Die Terminvergabe wird IMMER geprueft, auch vor der Eroeffnung: Es muss eine gueltige
    // Antwort mit einer slots-Liste kommen. Ob die Liste leer ist, ist ein anderer Befund --
    // vor buchbar_ab ist Leere planmaessig, danach waere sie ein Ausfall.
    let start = null;
    try { start = JSON.parse(l.text).buchbar_ab; } catch (e) { /* egal */ }
    const heute = new Date().toISOString().slice(0, 10);
    const tage = pruefTage(5).filter((t) => !start || t >= start);
    let antwortOk = false, zeiten = 0;
    for (const t of tage.length ? tage : pruefTage(5)) {
      const s = await hole(BASIS + '/api/gast/slots?datum=' + t + '&dauer=30');
      try {
        const j = JSON.parse(s.text);
        if (Array.isArray(j.slots)) { antwortOk = true; zeiten += j.slots.length; }
      } catch (e) { /* faellt unten auf */ }
      if (zeiten) break;
    }
    if (!antwortOk) fehler.push('Die Terminvergabe antwortet nicht verwertbar (Datenbank oder Oeffnungszeiten gestoert)');
    else if (!zeiten && start && start <= heute) {
      fehler.push('An den naechsten fuenf Werktagen ist kein einziger Termin frei — ausgebucht oder gestoert');
    }
  }

  // Notaus: Kein Ausfall, sondern eine bewusste Entscheidung -- aber eine, die man vergisst.
  // Steht er aus, nimmt die Website gar keine Buchungen an. Es kommt genau EINE Meldung beim
  // Abschalten und eine beim Wiedereinschalten, weil nur Zustandswechsel gemeldet werden.
  try {
    const { query } = require('../src/db/index');
    const r = await query('SELECT buchung_aktiv FROM einstellungen ORDER BY id LIMIT 1');
    if (r.rows.length && r.rows[0].buchung_aktiv === false) {
      fehler.push('Die Online-Buchung ist im Admin ABGESCHALTET — es kommen keine Buchungen herein');
    }
  } catch (e) {
    fehler.push('Die Datenbank ist nicht erreichbar (' + e.message + ')');
  }
  return fehler;
}

// Nur bei WECHSEL melden, nicht bei jedem Lauf. Eine Stoerung, die alle fuenf Minuten mailt,
// wird nach einer Stunde weggeklickt und dann auch die echte Meldung uebersehen.
async function melde(betreff, text) {
  if (!AN || !process.env.SMTP_HOST) return;
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await t.sendMail({
    from: '"' + (process.env.EMAIL_FROM_NAME || 'ReifenPro') + '" <' + process.env.EMAIL_FROM_ADDRESS + '>',
    to: AN, subject: betreff, text: text
  });
}

(async () => {
  const fehler = await pruefe();
  const jetzt = fehler.length ? 'gestoert' : 'ok';
  let vorher = 'ok';
  try { vorher = fs.readFileSync(STAND, 'utf8').trim() || 'ok'; } catch (e) { /* erster Lauf */ }
  const zeit = new Date().toLocaleString('de-DE');

  if (jetzt !== vorher) {
    try {
      if (jetzt === 'gestoert') {
        await melde('ReifenPro ist gestört', 'Seit ' + zeit + ' stimmt etwas nicht:\n\n  – '
          + fehler.join('\n  – ') + '\n\nGeprüft werden Startseite, Buchung, Portal, Admin und ob '
          + 'sich tatsächlich ein Termin buchen ließe.\n\nDiese Meldung kommt nur beim Wechsel, '
          + 'nicht alle fünf Minuten. Sobald es wieder läuft, kommt eine Entwarnung.');
      } else {
        await melde('ReifenPro läuft wieder', 'Seit ' + zeit + ' ist wieder alles erreichbar und buchbar.');
      }
    } catch (e) { console.error('[ueberwachung] Mail fehlgeschlagen:', e.message); }
    try { fs.mkdirSync(require('path').dirname(STAND), { recursive: true }); } catch (e) { /* egal */ }
    fs.writeFileSync(STAND, jetzt);
  }
  console.log('[' + new Date().toISOString() + '] ' + jetzt + (fehler.length ? ': ' + fehler.join(' | ') : ''));
  process.exit(0);
})();
