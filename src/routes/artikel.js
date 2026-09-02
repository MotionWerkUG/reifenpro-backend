'use strict';
const router = require('express').Router();
const { query } = require('../db/index');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { resolvePreis } = require('../lib/preis');

function dauerWert(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v);
  return Number.isFinite(n) ? n : null;
}

// Buchungsassistent-Rolle je Artikel steuern (Admin ist Herr ueber Haupt/Zusatz).
// Schreibt/aktualisiert die gemeinsame Tabelle buchung_leistungen; das Bild bleibt
// Sache der Homepage. Deaktivieren statt loeschen -> Bild/Titel bleiben fuer spaeter erhalten.
async function applyBuchungRolle(artikelId, rolle, name) {
  const r = (rolle === 'haupt' || rolle === 'zusatz') ? rolle : null;
  const vorhanden = (await query('SELECT id FROM buchung_leistungen WHERE artikel_id=$1 LIMIT 1', [artikelId])).rows[0];
  if (r) {
    if (vorhanden) {
      await query('UPDATE buchung_leistungen SET rolle=$1, aktiv=true WHERE artikel_id=$2', [r, artikelId]);
    } else {
      const sort = (await query('SELECT COALESCE(MAX(sortierung),0)+10 AS s FROM buchung_leistungen', [])).rows[0].s;
      await query(
        'INSERT INTO buchung_leistungen (artikel_id, rolle, titel, sortierung, aktiv) VALUES ($1,$2,$3,$4,true)',
        [artikelId, r, name || null, sort]
      );
    }
  } else if (vorhanden) {
    await query('UPDATE buchung_leistungen SET aktiv=false WHERE artikel_id=$1', [artikelId]);
  }
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, CASE WHEN bl.aktiv THEN bl.rolle ELSE NULL END AS buchung_rolle
       FROM artikel a
       LEFT JOIN buchung_leistungen bl ON bl.artikel_id = a.id
       WHERE a.aktiv=true ORDER BY a.sortierung, a.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, beschreibung, preis, mwst_satz, einheit, dauer_minuten, kategorie, artikelnr, buchung_rolle } = req.body;
    if (!name) return res.status(400).json({ error: 'Name ist Pflicht.' });
    const preisFehler = preisPruefen(preis, mwst_satz, dauer_minuten);
    if (preisFehler) return res.status(400).json({ error: preisFehler });
    if ((buchung_rolle === 'haupt' || buchung_rolle === 'zusatz') && dauerWert(dauer_minuten) === null) {
      return res.status(400).json({ error: 'Buchbare Leistungen (Haupt-/Zusatzleistung) brauchen eine Dauer in Minuten.' });
    }
    const { rows } = await query(
      `INSERT INTO artikel (name, beschreibung, preis, mwst_satz, einheit, dauer_minuten, kategorie, artikelnr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name.trim(), beschreibung || null, parseFloat(preis) || 0,
       parseFloat(mwst_satz) || 19, einheit || 'Stück',
       dauerWert(dauer_minuten), kategorie || 'sonstiges', artikelnr || null]
    );
    if ('buchung_rolle' in req.body) await applyBuchungRolle(rows[0].id, buchung_rolle, rows[0].name);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, beschreibung, preis, mwst_satz, einheit, dauer_minuten, kategorie, artikelnr, aktiv, buchung_rolle } = req.body;
    const preisFehlerU = preisPruefen(preis, mwst_satz, dauer_minuten);
    if (preisFehlerU) return res.status(400).json({ error: preisFehlerU });
    if ((buchung_rolle === 'haupt' || buchung_rolle === 'zusatz') && dauerWert(dauer_minuten) === null) {
      return res.status(400).json({ error: 'Buchbare Leistungen (Haupt-/Zusatzleistung) brauchen eine Dauer in Minuten.' });
    }
    const { rows } = await query(
      `UPDATE artikel SET
         name=$1, beschreibung=$2, preis=$3, mwst_satz=$4, einheit=$5,
         dauer_minuten=$6, kategorie=$7, artikelnr=$8, aktiv=$9
       WHERE id=$10 RETURNING *`,
      [name, beschreibung || null, parseFloat(preis) || 0,
       parseFloat(mwst_satz) || 19, einheit || 'Stück',
       dauerWert(dauer_minuten), kategorie || 'sonstiges',
       artikelnr || null, aktiv !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    // Nur anfassen, wenn das Feld explizit mitkommt -> Teil-Updates loeschen die Rolle nicht versehentlich.
    if ('buchung_rolle' in req.body) await applyBuchungRolle(req.params.id, buchung_rolle, rows[0].name);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await query('UPDATE artikel SET aktiv=false WHERE id=$1', [req.params.id]);
    // Zugehoerige Buchungszeile mit deaktivieren -> keine Leiche, die online sichtbar bleibt.
    await query('UPDATE buchung_leistungen SET aktiv=false WHERE artikel_id=$1', [req.params.id]);
    res.json({ message: 'Artikel deaktiviert.' });
  } catch (err) { next(err); }
});

// ── PREIS-/ZEITSTAFFEL je Fahrzeugtyp und Zollgroesse ──
const FZ_TYPEN = ['PKW', 'SUV', 'Transporter', 'Motorrad', 'Sonstiges'];
function intOrNull(v) { return (v !== null && v !== undefined && v !== '') ? parseInt(v) : null; }

// Grundwerte eines Artikels pruefen. Bisher wurde alles per parseFloat(...) || 0 uebernommen:
// Ein negativer Preis wurde klaglos gespeichert und haette in der Kalkulation die Summe
// gesenkt — ein Rabatt durch die Hintertuer, den niemand als solchen sieht.
function preisPruefen(preis, mwst, dauer) {
  if (preis !== undefined && preis !== null && preis !== '') {
    const p = parseFloat(preis);
    if (!Number.isFinite(p)) return 'Der Preis ist keine gültige Zahl.';
    if (p < 0) return 'Der Preis darf nicht negativ sein.';
    if (p > 100000) return 'Der Preis ist unplausibel hoch (über 100.000 €).';
  }
  if (mwst !== undefined && mwst !== null && mwst !== '') {
    const m = parseFloat(mwst);
    if (!Number.isFinite(m) || m < 0 || m > 25) return 'Der Mehrwertsteuersatz muss zwischen 0 und 25 Prozent liegen.';
  }
  if (dauer !== undefined && dauer !== null && dauer !== '') {
    const d = parseInt(dauer);
    if (!Number.isFinite(d) || d < 0) return 'Die Dauer darf nicht negativ sein.';
    if (d > 1440) return 'Die Dauer ist unplausibel hoch (über 24 Stunden).';
  }
  return null;
}

router.get('/:id/preise', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM artikel_preise WHERE artikel_id=$1 ORDER BY fahrzeug_typ NULLS FIRST, zoll_min NULLS FIRST', [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id/preis', authenticate, async (req, res, next) => {
  try {
    const a = (await query('SELECT * FROM artikel WHERE id=$1', [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: 'Artikel nicht gefunden.' });
    const varianten = (await query('SELECT * FROM artikel_preise WHERE artikel_id=$1', [req.params.id])).rows;
    res.json(resolvePreis(a, varianten, req.query.typ || null, req.query.zoll));
  } catch (err) { next(err); }
});

// Prueft eine Staffelzeile, bevor sie gespeichert wird. Bisher wurde alles angenommen:
// vertauschte Grenzen, negative Preise und vor allem UEBERLAPPENDE Bereiche. Ueberlappungen
// sind der gefaehrlichste Fall, weil sie nicht auffallen — der Kunde bekommt dann je nach
// Zeilenreihenfolge mal den einen, mal den anderen Preis angezeigt.
// Gibt null zurueck, wenn alles in Ordnung ist, sonst den Fehlertext.
async function staffelPruefen(artikelId, typ, min, max, preis, ausserId) {
  if (min !== null && max !== null && min > max)
    return `Die Zollgrößen sind vertauscht: von ${min} bis ${max} ergibt keinen Bereich.`;
  if (min !== null && (min < 1 || min > 40)) return 'Zollgröße "von" muss zwischen 1 und 40 liegen.';
  if (max !== null && (max < 1 || max > 40)) return 'Zollgröße "bis" muss zwischen 1 und 40 liegen.';
  if (!(preis >= 0)) return 'Der Preis darf nicht negativ sein.';

  const vorhanden = (await query(
    'SELECT id, fahrzeug_typ, zoll_min, zoll_max FROM artikel_preise WHERE artikel_id=$1', [artikelId])).rows;
  const von = min === null ? -Infinity : min;
  const bis = max === null ? Infinity : max;
  for (const v of vorhanden) {
    if (ausserId && String(v.id) === String(ausserId)) continue;
    // Nur Zeilen desselben Fahrzeugtyps koennen sich in die Quere kommen; eine SUV-Regel
    // und eine allgemeine Regel duerfen sich ueberschneiden, dort gewinnt bewusst der Typ.
    if ((v.fahrzeug_typ || null) !== (typ || null)) continue;
    const vVon = v.zoll_min === null ? -Infinity : v.zoll_min;
    const vBis = v.zoll_max === null ? Infinity : v.zoll_max;
    if (von <= vBis && vVon <= bis) {
      const zeigen = (a, b) => (a === -Infinity ? 'alle' : a) + ' bis ' + (b === Infinity ? 'offen' : b);
      return `Der Bereich ${zeigen(von, bis)} Zoll überschneidet sich mit einer vorhandenen `
        + `Staffel (${zeigen(vVon, vBis)} Zoll${typ ? ', ' + typ : ''}). `
        + 'Bitte die Bereiche so wählen, dass sie sich nicht überlappen — sonst ist nicht '
        + 'eindeutig, welcher Preis gilt.';
    }
  }
  return null;
}

// Meldet Luecken in der Staffel. Eine Luecke ist nicht falsch — sie faellt still auf den
// Grundpreis des Artikels zurueck. Genau das ist die Gefahr: Wer "bis 16" und "ab 19"
// anlegt, merkt nicht, dass ein 17-Zoeller ploetzlich den Grundpreis kostet. Der Hinweis
// macht es sichtbar, verbietet aber nichts.
const ZOLL_VON = 13, ZOLL_BIS = 24;  // uebliche Radgroessen im Pkw-Bereich

router.get('/:id/preise/pruefung', authenticate, async (req, res, next) => {
  try {
    const a = (await query('SELECT id, name, preis FROM artikel WHERE id=$1', [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: 'Artikel nicht gefunden.' });
    const rows = (await query('SELECT * FROM artikel_preise WHERE artikel_id=$1', [req.params.id])).rows;

    const deckt = (v, z) => {
      const hatStaffel = v.zoll_min !== null || v.zoll_max !== null;
      if (!hatStaffel) return true;                       // gilt fuer jede Groesse
      return (v.zoll_min === null || z >= v.zoll_min) && (v.zoll_max === null || z <= v.zoll_max);
    };
    // Nur Typen pruefen, fuer die es ueberhaupt eigene Zeilen gibt, plus die allgemeine Staffel.
    const typen = [...new Set(rows.map((v) => v.fahrzeug_typ || null))];
    const hinweise = [];

    for (const typ of typen) {
      const offen = [];
      for (let z = ZOLL_VON; z <= ZOLL_BIS; z++) {
        // Eigene Zeile des Typs gewinnt; sonst greift eine allgemeine Zeile.
        const passt = rows.some((v) => (v.fahrzeug_typ || null) === typ && deckt(v, z))
          || rows.some((v) => !v.fahrzeug_typ && deckt(v, z));
        if (!passt) offen.push(z);
      }
      if (!offen.length) continue;
      // Zusammenhaengende Groessen zu Bereichen zusammenfassen, damit die Meldung lesbar bleibt.
      const bereiche = [];
      let start = offen[0], vorher = offen[0];
      for (const z of offen.slice(1)) {
        if (z === vorher + 1) { vorher = z; continue; }
        bereiche.push(start === vorher ? `${start}"` : `${start}–${vorher}"`);
        start = z; vorher = z;
      }
      bereiche.push(start === vorher ? `${start}"` : `${start}–${vorher}"`);
      hinweise.push({
        fahrzeug_typ: typ,
        luecken: bereiche,
        text: `${typ || 'Alle Fahrzeuge'}: für ${bereiche.join(', ')} ist keine Staffel hinterlegt — `
          + `dort gilt der Standardpreis von ${Number(a.preis).toFixed(2)} €.`,
      });
    }
    res.json({ artikel: a.name, standardpreis: a.preis, geprueft_von: ZOLL_VON, geprueft_bis: ZOLL_BIS, hinweise });
  } catch (err) { next(err); }
});

router.post('/:id/preise', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { fahrzeug_typ, zoll_min, zoll_max, preis, mwst_satz, dauer_minuten } = req.body;
    const typ = FZ_TYPEN.includes(fahrzeug_typ) ? fahrzeug_typ : null;
    const fehler = await staffelPruefen(req.params.id, typ, intOrNull(zoll_min), intOrNull(zoll_max), parseFloat(preis) || 0, null);
    if (fehler) return res.status(400).json({ error: fehler });
    const { rows } = await query(
      `INSERT INTO artikel_preise (artikel_id, fahrzeug_typ, zoll_min, zoll_max, preis, mwst_satz, dauer_minuten)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, typ, intOrNull(zoll_min), intOrNull(zoll_max), parseFloat(preis) || 0, parseFloat(mwst_satz) || 19, intOrNull(dauer_minuten)]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id/preise/:vid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { fahrzeug_typ, zoll_min, zoll_max, preis, mwst_satz, dauer_minuten } = req.body;
    const typ = FZ_TYPEN.includes(fahrzeug_typ) ? fahrzeug_typ : null;
    // Die eigene Zeile beim Ueberlappungstest ausnehmen, sonst kollidiert jede Aenderung
    // mit sich selbst.
    const fehler = await staffelPruefen(req.params.id, typ, intOrNull(zoll_min), intOrNull(zoll_max), parseFloat(preis) || 0, req.params.vid);
    if (fehler) return res.status(400).json({ error: fehler });
    const { rows } = await query(
      `UPDATE artikel_preise SET fahrzeug_typ=$1, zoll_min=$2, zoll_max=$3, preis=$4, mwst_satz=$5, dauer_minuten=$6
       WHERE id=$7 AND artikel_id=$8 RETURNING *`,
      [typ, intOrNull(zoll_min), intOrNull(zoll_max), parseFloat(preis) || 0, parseFloat(mwst_satz) || 19, intOrNull(dauer_minuten), req.params.vid, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Variante nicht gefunden.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id/preise/:vid', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query('DELETE FROM artikel_preise WHERE id=$1 AND artikel_id=$2 RETURNING id', [req.params.vid, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json({ message: 'Gelöscht.' });
  } catch (err) { next(err); }
});

module.exports = router;
