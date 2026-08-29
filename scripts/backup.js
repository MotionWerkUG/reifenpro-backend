'use strict';
// Aktiv (Modell A): /home/deploy/projekte/reifenpro/scripts/backup.js
// Taeglich 03:00 per Cron. Sichert (1) die Datenbank als .sql.gz und (2) die Dateien
// (Rechnungs-PDFs, Uploads, Gewerbe-Dokumente) als .tar.gz. 30 Tage Aufbewahrung, Rotation.
// Montags zusaetzlich beide aktuellen Sicherungen per E-Mail (Offsite-Kopie).
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const DIR  = process.env.BACKUP_DIR || '/var/backups/reifenpro';
const KEEP = parseInt(process.env.BACKUP_KEEP_DAYS) || 30;

// Zu sichernde Datei-Verzeichnisse (nur vorhandene werden eingepackt)
const FILE_DIRS = [
  '/home/deploy/projekte/reifenpro/rechnungen',        // Rechnungs-PDFs (GoBD) — aktives Projekt (Modell A)
  '/home/deploy/projekte/reifenpro/gewerbe-dokumente', // hochgeladene Gewerbeanmeldungen
  '/home/deploy/projekte/reifenpro/protokoll-dateien', // Uebergabeprotokolle mit Unterschrift + Fotos (aufbewahrungspflichtig)
  '/var/www/schroeder-homepage/uploads',               // Homepage-/CMS-Bilder
];

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

// Eine Sicherung, die niemand prueft, ist keine Sicherung. Der Dump muss lesbar sein und
// wie ein pg_dump aussehen — sonst wird die Datei geloescht und der Lauf schlaegt fehl,
// damit der Fehler auffaellt statt als "Fertig." im Log zu verschwinden.
function pruefeDump(datei) {
  const groesse = fs.statSync(datei).size;
  let kopf = '';
  try { kopf = execSync('gunzip -c "' + datei + '" | head -c 400', { shell: '/bin/bash' }).toString(); }
  catch (e) { kopf = ''; }
  const plausibel = groesse > 1024 && /PostgreSQL database dump/i.test(kopf) && /CREATE TABLE|COPY /.test(
    (function () { try { return execSync('gunzip -c "' + datei + '" | head -c 200000', { shell: '/bin/bash' }).toString(); } catch (e) { return ''; } })()
  );
  if (!plausibel) {
    try { fs.unlinkSync(datei); } catch (e) { /* egal */ }
    throw new Error('Datenbank-Sicherung unbrauchbar (' + groesse + ' Bytes, kein gueltiger pg_dump-Inhalt). Datei verworfen.');
  }
}
function mb(p) { return (fs.statSync(p).size / 1024 / 1024).toFixed(2); }

async function main() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const s = stamp();

  // ── 1) Datenbank ──
  const dbName = 'reifenpro_' + s + '.sql.gz';
  const dbDest = path.join(DIR, dbName);
  console.log('[Backup] Starte DB: ' + dbName);
  // WICHTIG: 'set -o pipefail' und bash als Shell. Ohne das ist der Exitcode der von gzip,
  // und ein fehlgeschlagener pg_dump erzeugt eine leere Datei, die als Erfolg gemeldet wird.
  // Das Passwort kommt ueber die Umgebung, nicht in die Kommandozeile: bei einem Fehler
  // steht der komplette Befehl in der Meldung und landete sonst im Logfile.
  try {
    execSync(
      'set -o pipefail; pg_dump ' +
      '-h ' + (process.env.DB_HOST || 'localhost') + ' ' +
      '-p ' + (process.env.DB_PORT || 5432) + ' ' +
      '-U ' + process.env.DB_USER + ' ' + process.env.DB_NAME +
      ' | gzip > "' + dbDest + '"',
      { stdio: 'pipe', shell: '/bin/bash', env: Object.assign({}, process.env, { PGPASSWORD: process.env.DB_PASSWORD }) }
    );
  } catch (err) {
    try { fs.unlinkSync(dbDest); } catch (e) { /* egal */ }
    throw new Error('Datenbank-Sicherung fehlgeschlagen: ' + String(err.stderr || err.message).trim().split('\n').slice(-2).join(' '));
  }
  pruefeDump(dbDest);
  console.log('[Backup] DB erstellt: ' + dbDest + ' (' + mb(dbDest) + ' MB)');

  // ── 2) Dateien (Rechnungs-PDFs, Uploads, Gewerbe-Dokumente) ──
  const vorhanden = FILE_DIRS.filter(function (d) { return fs.existsSync(d); });
  let fileDest = null;
  if (vorhanden.length) {
    const fileName = 'reifenpro-dateien_' + s + '.tar.gz';
    fileDest = path.join(DIR, fileName);
    // je Verzeichnis ein "-C <Elternpfad> <Ordnername>", damit relative Pfade gespeichert werden
    const segs = vorhanden.map(function (d) {
      return '-C "' + path.dirname(d) + '" "' + path.basename(d) + '"';
    }).join(' ');
    console.log('[Backup] Starte Dateien: ' + fileName + ' (' + vorhanden.length + ' Verzeichnisse)');
    execSync('tar -czf "' + fileDest + '" ' + segs, { stdio: 'pipe' });
    console.log('[Backup] Dateien erstellt: ' + fileDest + ' (' + mb(fileDest) + ' MB)');
  } else {
    console.log('[Backup] Keine Datei-Verzeichnisse vorhanden – Datei-Backup uebersprungen.');
  }

  // ── Dauerarchiv: einmal je Monat eine Kopie, die NIE rotiert wird ──
  // Die tägliche Sicherung reicht 30 Tage zurück, die Aufbewahrungspflicht für Belege
  // acht Jahre. Ohne diese Kopie waere ein Beleg, dessen Verlust erst nach zwei Monaten
  // auffaellt, endgueltig weg. Der erste Lauf eines Monats legt den Monatsstand an.
  const monat = new Date().toISOString().slice(0, 7);
  const archivDir = path.join(DIR, 'dauerarchiv');
  if (!fs.existsSync(archivDir)) fs.mkdirSync(archivDir, { recursive: true });
  const archivDb = path.join(archivDir, 'reifenpro_' + monat + '.sql.gz');
  if (!fs.existsSync(archivDb)) {
    fs.copyFileSync(dbDest, archivDb);
    console.log('[Backup] Dauerarchiv angelegt: ' + path.basename(archivDb) + ' (' + mb(archivDb) + ' MB)');
  }
  if (fileDest) {
    const archivDat = path.join(archivDir, 'reifenpro-dateien_' + monat + '.tar.gz');
    if (!fs.existsSync(archivDat)) {
      fs.copyFileSync(fileDest, archivDat);
      console.log('[Backup] Dauerarchiv angelegt: ' + path.basename(archivDat) + ' (' + mb(archivDat) + ' MB)');
    }
  }

  // ── Rotation: alte DB- und Datei-Backups loeschen ──
  // Achtung: greift bewusst NUR im Hauptordner, nie im Unterordner 'dauerarchiv'.
  const grenze = new Date(Date.now() - KEEP * 86400000);
  fs.readdirSync(DIR)
    .filter(function (f) { return /^reifenpro_.*\.sql\.gz$/.test(f) || /^reifenpro-dateien_.*\.tar\.gz$/.test(f); })
    .forEach(function (f) {
      const fp = path.join(DIR, f);
      if (!fs.statSync(fp).isFile()) return;
      if (fs.statSync(fp).mtime < grenze) { fs.unlinkSync(fp); console.log('[Backup] Geloescht: ' + f); }
    });

  // ── Montags: Offsite-Kopie per E-Mail (DB + Dateien) ──
  const istMontag = new Date().getDay() === 1;
  if (istMontag && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    console.log('[Backup] Montag — sende E-Mail...');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const datumStr = new Date().toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const anhaenge = [{ filename: dbName, path: dbDest }];
    if (fileDest) anhaenge.push({ filename: path.basename(fileDest), path: fileDest });
    await transporter.sendMail({
      from: '"ReifenPro Backup" <' + process.env.SMTP_USER + '>',
      to: process.env.BACKUP_MAIL_TO || process.env.SMTP_USER,
      subject: 'ReifenPro Wochenbackup ' + datumStr,
      html:
        '<h2>ReifenPro - Woechentliches Backup</h2>' +
        '<p>Datum: <strong>' + datumStr + '</strong></p>' +
        '<p>Im Anhang das aktuelle Datenbank-Backup' + (fileDest ? ' sowie das Datei-Backup (Rechnungs-PDFs, Uploads, Dokumente)' : '') + '.</p>' +
        '<ul>' + anhaenge.map(function (a) { return '<li>' + a.filename + ' (' + mb(a.path) + ' MB)</li>'; }).join('') + '</ul>',
      attachments: anhaenge,
    });
    console.log('[Backup] E-Mail gesendet an ' + (process.env.BACKUP_MAIL_TO || process.env.SMTP_USER));
  }

  console.log('[Backup] Fertig.');
}

main().catch(function (err) {
  console.error('[Backup] Fehler:', err.message);
  process.exit(1);
});
