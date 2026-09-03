// Rollen ansehen und bearbeiten. Nur der Inhaber.
//
// Die Rechte selbst liegen in lib/rechte.js und in den Tabellen rollen / rollen_rechte /
// rollen_befugnisse. Diese Datei ist nur die Tuer dorthin -- die Regeln stehen an einer Stelle,
// nicht zweimal.
const router = require('express').Router();
const { query, withTransaction } = require('../db/index');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');
const rechte = require('../lib/rechte');

router.use(authenticate, requireAdmin);

const STUFEN = ['kein', 'ansehen', 'bearbeiten'];

// Alle Bereiche, die es gibt -- abgeleitet aus derselben Zuordnung, die auch sperrt.
// So kann in der Oberflaeche kein Bereich auftauchen, den der Torwaechter nicht kennt,
// und keiner fehlen, den er kennt.
const BEREICHE = [
  { schluessel: 'dashboard',       name: 'Dashboard',            gruppe: 'Tagesgeschäft',  beschreibung: 'Übersicht mit Kennzahlen und offenen Aufgaben' },
  { schluessel: 'werkstatt',       name: 'Werkstatt',            gruppe: 'Tagesgeschäft',  beschreibung: 'Tagesliste, abhaken, Protokolle' },
  { schluessel: 'kalender',        name: 'Kalender',             gruppe: 'Tagesgeschäft',  beschreibung: 'Termine anlegen, verschieben, absagen' },
  { schluessel: 'lagerplan',       name: 'Lagerplan',            gruppe: 'Tagesgeschäft',  beschreibung: 'Plätze belegen und freigeben' },
  { schluessel: 'einlagerungen',   name: 'Einlagerungen',        gruppe: 'Tagesgeschäft',  beschreibung: 'Räder annehmen und herausgeben' },
  { schluessel: 'kunden',          name: 'Kunden',               gruppe: 'Kundendaten',    beschreibung: 'Suchen, Akte öffnen, Stammdaten pflegen' },
  { schluessel: 'kontaktanfragen', name: 'Kontaktanfragen',      gruppe: 'Kundendaten',    beschreibung: 'Nachrichten über die Website' },
  { schluessel: 'gewerbeanfragen', name: 'Gewerbeanfragen',      gruppe: 'Kundendaten',    beschreibung: 'Anträge mit Gewerbenachweis' },
  { schluessel: 'rechnungen',      name: 'Rechnungen',           gruppe: 'Rechnungswesen', beschreibung: 'Belege, Entwürfe, Mahnungen' },
  { schluessel: 'artikel',         name: 'Artikel und Preise',   gruppe: 'Rechnungswesen', beschreibung: 'Leistungen, Staffelpreise, Dauer' },
  { schluessel: 'gutscheine',      name: 'Gutscheine',           gruppe: 'Rechnungswesen', beschreibung: 'Aktionscodes und Nachlässe' },
  { schluessel: 'statistik',       name: 'Statistik',            gruppe: 'Rechnungswesen', beschreibung: 'Umsätze, Auslastung, Besucher' },
  { schluessel: 'website',         name: 'Website und Inhalte',  gruppe: 'System',         beschreibung: 'Texte, Bilder, Banner, Preisseite' },
  { schluessel: 'datenschutz',     name: 'Datenschutz',          gruppe: 'System',         beschreibung: 'Auskunft und Löschanträge' },
  { schluessel: 'einstellungen',   name: 'Einstellungen',        gruppe: 'System',         beschreibung: 'Firma, Öffnungszeiten, Notaus, Benutzer' }
];

const BEFUGNISSE = [
  { schluessel: 'rechnung_festschreiben', name: 'Rechnung festschreiben und stornieren', beschreibung: 'Eine Rechnung schreiben ist etwas anderes, als sie unwiderruflich zu machen.' },
  { schluessel: 'kunde_loeschen',         name: 'Kundenkonto endgültig löschen',         beschreibung: 'Unumkehrbar, mit Auswirkung auf Aufbewahrungspflichten.' },
  { schluessel: 'einlagerung_loeschen',   name: 'Einlagerung löschen',                   beschreibung: 'Entfernt einen Geschäftsbeleg.' },
  { schluessel: 'etikett_drucken',        name: 'Etiketten drucken',                     beschreibung: 'Harmlos, wird im Tagesgeschäft ständig gebraucht.' }
];

router.get('/', async (req, res, next) => {
  try {
    const rollen = (await query('SELECT id, schluessel, name, beschreibung, system, vollzugriff FROM rollen ORDER BY vollzugriff DESC, name')).rows;
    const rr = (await query('SELECT rolle_id, bereich, stufe FROM rollen_rechte')).rows;
    const rb = (await query('SELECT rolle_id, befugnis FROM rollen_befugnisse')).rows;
    const zahl = (await query("SELECT rolle, COUNT(*)::int AS n FROM users WHERE aktiv GROUP BY rolle")).rows;
    res.json({
      bereiche: BEREICHE, befugnisse: BEFUGNISSE, stufen: STUFEN,
      rollen: rollen.map((r) => ({
        ...r,
        personen: (zahl.find((z) => z.rolle === r.schluessel) || {}).n || 0,
        rechte: Object.fromEntries(rr.filter((x) => x.rolle_id === r.id).map((x) => [x.bereich, x.stufe])),
        befugnisse: rb.filter((x) => x.rolle_id === r.id).map((x) => x.befugnis)
      }))
    });
  } catch (e) { next(e); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const r = (await query('SELECT * FROM rollen WHERE id=$1', [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Rolle nicht gefunden.' });
    // Der Inhaber laesst sich nicht einschraenken. Ohne diese Sperre gaebe es den Fall, in dem
    // sich jemand selbst aussperrt und niemand mehr an die Einstellungen kommt.
    if (r.vollzugriff) return res.status(409).json({ error: 'Die Rolle „' + r.name + '" hat immer Vollzugriff und lässt sich nicht einschränken.' });

    const rechteNeu = req.body && req.body.rechte || {};
    const befugNeu = Array.isArray(req.body && req.body.befugnisse) ? req.body.befugnisse : [];
    const gueltigeBereiche = new Set(BEREICHE.map((b) => b.schluessel));
    const gueltigeBefug = new Set(BEFUGNISSE.map((b) => b.schluessel));
    for (const [b, st] of Object.entries(rechteNeu)) {
      if (!gueltigeBereiche.has(b)) return res.status(400).json({ error: 'Unbekannter Bereich: ' + b });
      if (!STUFEN.includes(st)) return res.status(400).json({ error: 'Unbekannte Stufe: ' + st });
    }
    for (const bf of befugNeu) if (!gueltigeBefug.has(bf)) return res.status(400).json({ error: 'Unbekannte Befugnis: ' + bf });

    await withTransaction(async (c) => {
      if (req.body && typeof req.body.name === 'string' && req.body.name.trim() && !r.system) {
        await c.query('UPDATE rollen SET name=$1, beschreibung=$2, geaendert_am=NOW() WHERE id=$3',
          [req.body.name.trim().slice(0, 60), String(req.body.beschreibung || '').slice(0, 300), r.id]);
      }
      await c.query('DELETE FROM rollen_rechte WHERE rolle_id=$1', [r.id]);
      for (const b of BEREICHE) {
        await c.query('INSERT INTO rollen_rechte (rolle_id, bereich, stufe) VALUES ($1,$2,$3)',
          [r.id, b.schluessel, rechteNeu[b.schluessel] || 'kein']);
      }
      await c.query('DELETE FROM rollen_befugnisse WHERE rolle_id=$1', [r.id]);
      for (const bf of befugNeu) await c.query('INSERT INTO rollen_befugnisse (rolle_id, befugnis) VALUES ($1,$2)', [r.id, bf]);
    });
    rechte.leeren();   // Zwischenspeicher verwerfen, sonst wirkt die Aenderung erst nach einer Minute
    await auditLog({ userId: req.user.id, aktion: 'rolle.rechte_geaendert', tabelle: 'rollen', datensatzId: r.id });
    res.json({ message: 'Rechte gespeichert.' });
  } catch (e) { next(e); }
});

module.exports = router;
