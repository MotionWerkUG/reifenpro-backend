// Rollen und Rechte — eine Stelle, an der entschieden wird, wer was darf.
//
// WARUM ES DIESE DATEI GIBT: Die Rechte lagen bisher als requireStaff/requireAdmin verstreut in
// 163 Routen. Wer wissen wollte, was ein Mitarbeiter darf, musste 22 Dateien lesen — und bekam
// die Antwort "alles ausser 31 Ausnahmen". Hier steht die Zuordnung von Pfad zu Bereich einmal,
// und die Pruefung greift fuer jede Route, auch fuer neue.
//
// GRUNDREGEL: Was nicht ausdruecklich zugeordnet ist, ist Sache des Inhabers. Ein neuer,
// vergessener Bereich ist damit zu streng statt zu offen — der Fehler faellt sofort auf, statt
// still eine Luecke zu lassen.
const { query } = require('../db/index');

// Pfad -> Bereich. Der Pfad ist der Einhaengepunkt aus server.js, nicht die einzelne Route.
const BEREICH_JE_PFAD = {
  aktivitaet:   'dashboard',
  termine:      'kalender',
  protokolle:   'werkstatt',
  station:      'werkstatt',
  lager:        'lagerplan',
  einlagerungen:'einlagerungen',
  kunden:       'kunden',
  kontakt:      'kontaktanfragen',
  gewerbe:      'gewerbeanfragen',
  rechnungen:   'rechnungen',
  artikel:      'artikel',
  gutscheine:   'gutscheine',
  besucher:     'statistik',
  homepage:     'website',
  dsgvo:        'datenschutz',
  einstellungen:'einstellungen',
  users:        'einstellungen',   // Benutzerverwaltung liegt in den Einstellungen
  rollen:       'einstellungen',   // Rollenverwaltung ebenso
  dokumente:    'kunden',          // Kundendokumente haengen an der Kundenakte
  zustimmung:   'kalender'         // Zustimmung gehoert zum Termin
};

// Diese Pfade tragen ihre eigene Pruefung und duerfen NICHT ueber Rollen laufen:
// oeffentliche Endpunkte fuer Website, Kundenportal und die Anmeldung selbst.
const OHNE_ROLLENPRUEFUNG = new Set([
  'auth', 'portal', 'gast', 'adresse', 'preise', 'qr', 'dokument-scan'
]);

const RANG = { kein: 0, ansehen: 1, bearbeiten: 2 };

// Lesende Verfahren brauchen 'ansehen', alles andere 'bearbeiten'.
function noetigeStufe(methode) {
  return (methode === 'GET' || methode === 'HEAD') ? 'ansehen' : 'bearbeiten';
}

function bereichFuerPfad(pfad) {
  const teil = String(pfad || '').replace(/^\/+/, '').split('/')[0];
  if (OHNE_ROLLENPRUEFUNG.has(teil)) return null;   // eigene Pruefung
  return BEREICH_JE_PFAD[teil] || '__unbekannt__';  // unbekannt -> nur Inhaber
}

// Kleiner Zwischenspeicher: Die Matrix aendert sich selten, wird aber bei jeder Anfrage
// gebraucht. Wer sie aendert, ruft leeren() auf.
let speicher = null, speicherZeit = 0;
const SPEICHER_MS = 60000;

async function matrix() {
  if (speicher && Date.now() - speicherZeit < SPEICHER_MS) return speicher;
  const rollen = (await query('SELECT id, schluessel, name, vollzugriff FROM rollen')).rows;
  const rechte = (await query('SELECT rolle_id, bereich, stufe FROM rollen_rechte')).rows;
  const befug = (await query('SELECT rolle_id, befugnis FROM rollen_befugnisse')).rows;
  const m = {};
  for (const r of rollen) {
    m[r.schluessel] = { name: r.name, vollzugriff: r.vollzugriff, bereiche: {}, befugnisse: new Set() };
  }
  for (const r of rollen) {
    for (const x of rechte) if (x.rolle_id === r.id) m[r.schluessel].bereiche[x.bereich] = x.stufe;
    for (const x of befug) if (x.rolle_id === r.id) m[r.schluessel].befugnisse.add(x.befugnis);
  }
  speicher = m; speicherZeit = Date.now();
  return m;
}
function leeren() { speicher = null; }

async function stufeFuer(rolleSchluessel, bereich) {
  const m = await matrix();
  const r = m[rolleSchluessel];
  if (!r) return 'kein';                 // unbekannte Rolle darf nichts
  if (r.vollzugriff) return 'bearbeiten';
  return r.bereiche[bereich] || 'kein';  // nicht eingetragen = gesperrt
}

async function hatBefugnis(rolleSchluessel, befugnis) {
  const m = await matrix();
  const r = m[rolleSchluessel];
  if (!r) return false;
  if (r.vollzugriff) return true;
  return r.befugnisse.has(befugnis);
}

// Welche Bereiche darf diese Rolle ueberhaupt sehen? Das Frontend baut daraus sein Menue —
// aus derselben Quelle, aus der auch gesperrt wird.
async function sichtbareBereiche(rolleSchluessel) {
  const m = await matrix();
  const r = m[rolleSchluessel];
  if (!r) return {};
  if (r.vollzugriff) {
    const alle = {};
    for (const b of new Set(Object.values(BEREICH_JE_PFAD))) alle[b] = 'bearbeiten';
    return alle;
  }
  const sichtbar = {};
  for (const [b, s] of Object.entries(r.bereiche)) if (s !== 'kein') sichtbar[b] = s;
  return sichtbar;
}

// Die Sperre selbst. Wird in server.js EINMAL vor die Router gehaengt.
function torwaechter(authenticate) {
  return async function (req, res, next) {
    try {
      const bereich = bereichFuerPfad(req.path);
      if (bereich === null) return next();                 // oeffentlich / eigene Pruefung
      if (!req.headers.authorization) return next();       // ohne Token: der Router antwortet mit 401
      await new Promise((fertig, fehler) => authenticate(req, res, (e) => e ? fehler(e) : fertig()));
      if (!req.user) return;                               // authenticate hat bereits geantwortet
      const stufe = await stufeFuer(req.user.rolle, bereich);
      if (RANG[stufe] < RANG[noetigeStufe(req.method)]) {
        return res.status(403).json({
          code: 'KEIN_RECHT',
          error: 'Ihre Rolle hat für diesen Bereich keine Berechtigung. Wenden Sie sich an den Inhaber.'
        });
      }
      next();
    } catch (e) { next(e); }
  };
}

module.exports = {
  BEREICH_JE_PFAD, OHNE_ROLLENPRUEFUNG, bereichFuerPfad, noetigeStufe,
  stufeFuer, hatBefugnis, sichtbareBereiche, torwaechter, leeren, matrix
};
