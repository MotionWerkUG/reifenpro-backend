const router = require('express').Router();
const { execFileSync } = require('child_process');
const path = require('path');
const { query, withTransaction } = require('../db/index');
const { authenticate, requireStaff } = require('../middleware/auth');
const { auditLog } = require('../middleware/errorHandler');

router.get('/', authenticate, requireStaff, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT d.*, k.vorname || ' ' || k.nachname AS kundenname, k.email
       FROM dsgvo_anfragen d
       JOIN kunden k ON d.kunden_id = k.id
       ORDER BY d.erstellt_am DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/auskunft/:kundenId', authenticate, requireStaff, async (req, res, next) => {
  try {
    const kid = req.params.kundenId;
    const [k, einl, docs, anf] = await Promise.all([
      query('SELECT * FROM kunden WHERE id=$1', [kid]),
      query('SELECT beleg_nr,reifen_groesse,reifen_typ,lagerplatz,status,eingelagert_am FROM einlagerungen WHERE kunden_id=$1', [kid]),
      query('SELECT typ,titel,erstellt_am,unterschrift_datum FROM kunden_dokumente WHERE kunden_id=$1', [kid]),
      query('SELECT typ,status,erstellt_am FROM dsgvo_anfragen WHERE kunden_id=$1', [kid]),
    ]);
    if (!k.rows.length) return res.status(404).json({ error: 'Kunde nicht gefunden.' });

    const kunde = {...k.rows[0]};
    delete kunde.portal_password;

    const auskunft = {
      generiert_am: new Date().toISOString(),
      rechtsgrundlage: 'Art. 15 DSGVO',
      gespeicherte_daten: {
        stammdaten: kunde,
        einlagerungen: einl.rows,
        dokumente: docs.rows,
        dsgvo_anfragen: anf.rows,
      },
      aufbewahrungsfristen: {
        rechnungen: '10 Jahre (§ 147 AO, § 14b UStG)',
        buchungsbelege: '8 Jahre ab Ausstellung (§ 257 HGB, BEG IV ab 01.01.2025)',
        kontaktdaten: 'Bis Ende der Geschäftsbeziehung',
      },
      betroffenenrechte: [
        'Art. 15 DSGVO - Auskunftsrecht',
        'Art. 16 DSGVO - Recht auf Berichtigung',
        'Art. 17 DSGVO - Recht auf Löschung',
        'Art. 18 DSGVO - Recht auf Einschränkung',
        'Art. 20 DSGVO - Recht auf Datenübertragbarkeit',
        'Art. 21 DSGVO - Widerspruchsrecht',
        'Art. 7 Abs. 3 DSGVO - Widerruf der Einwilligung',
        'Art. 77 DSGVO - Beschwerderecht bei BayLDA (www.lda.bayern.de)',
      ],
    };

    await query(
      `INSERT INTO dsgvo_anfragen (kunden_id,typ,status,bearbeitet_am,bearbeitet_von)
       VALUES ($1,'auskunft','bearbeitet',NOW(),$2)`,
      [kid, req.user.id]
    );
    res.json(auskunft);
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, requireStaff, async (req, res, next) => {
  try {
    const { status, antwort } = req.body;
    const { rows } = await query(
      `UPDATE dsgvo_anfragen
       SET status=$1, antwort=$2, bearbeitet_am=NOW(), bearbeitet_von=$3
       WHERE id=$4 RETURNING *`,
      [status, antwort||null, req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/loeschung/:kundenId', authenticate, requireStaff, async (req, res, next) => {
  try {
    const kid = req.params.kundenId;
    if (!/^[0-9a-fA-F-]{36}$/.test(kid)) return res.status(400).json({ error: 'Ungültige Kunden-ID.' });

    const { rows: aktiv } = await query(
      "SELECT COUNT(*) AS cnt FROM einlagerungen WHERE kunden_id=$1 AND status!='Abgeholt'",
      [kid]
    );
    if (parseInt(aktiv[0].cnt) > 0)
      return res.status(400).json({ error: 'Kunde hat noch aktive Einlagerungen.' });

    // Aufbewahrungspflicht: sobald Geschaeftsunterlagen existieren (Einlagerungen, Rechnungen,
    // Arbeitsprotokolle) wird NICHT hart geloescht, sondern anonymisiert (§ 257 HGB / § 147 AO / GoBD).
    // Diese Tabellen haben zudem FK RESTRICT/NO ACTION auf kunden und wuerden ein DELETE ohnehin blockieren.
    const { rows: aufb } = await query(
      `SELECT (SELECT COUNT(*) FROM einlagerungen WHERE kunden_id=$1)
            + (SELECT COUNT(*) FROM rechnungen   WHERE kunden_id=$1)
            + (SELECT COUNT(*) FROM protokolle   WHERE kunden_id=$1) AS cnt`,
      [kid]
    );
    const aufbewahrungspflicht = parseInt(aufb[0].cnt) > 0;

    // Zuerst archivieren (E-Mail + Datei)
    try {
      const scriptPfad = path.join(__dirname, '../../scripts/archiviere_kunde.js');
      execFileSync('node', [scriptPfad, kid], { timeout: 30000, stdio: 'pipe' });
    } catch (archivErr) {
      console.error('[DSGVO] Archivierung fehlgeschlagen:', archivErr.message);
      // Trotzdem weitermachen — Loeschung nicht blockieren
    }

    if (aufbewahrungspflicht) {
      await query(
        `UPDATE kunden SET
          vorname='Geloeschter', nachname='Kunde', telefon='geloescht',
          telefon2=NULL, email=NULL, strasse=NULL, plz=NULL, ort=NULL,
          kennzeichen=NULL, fahrzeug_marke=NULL, fahrzeug_modell=NULL,
          baujahr=NULL, notizen=NULL, portal_aktiv=false,
          portal_email=NULL, portal_password=NULL, portal_verifiziert=false,
          anonymisiert_am=NOW(), geloescht_am=NOW()
         WHERE id=$1`,
        [kid]
      );
      await auditLog({ userId: req.user.id, aktion: 'kunde.anonymisiert',
        tabelle: 'kunden', datensatzId: kid, req });
      res.json({
        message: 'Kundenkonto anonymisiert und archiviert.',
        hinweis: 'Einlagerungsdaten werden gemäß § 257 HGB noch 8 Jahre aufbewahrt.',
        aufbewahrungspflicht: true,
      });
    } else {
      // Vollstaendige Loeschung transaktional: sonst blieben bei einem Fehler (z.B. FK RESTRICT
      // auf fahrzeuge) bereits geloeschte Dokumente/Anfragen zurueck -> inkonsistenter Zustand.
      // fahrzeuge zuerst (FK RESTRICT); kunden_preise/passwort_reset_tokens loescht CASCADE mit.
      await withTransaction(async (client) => {
        // termine.fahrzeug_id referenziert fahrzeuge mit NO ACTION -> vor dem Loeschen entkoppeln,
        // sonst blockiert ein noch vorhandener Termin das DELETE fahrzeuge (Rollback).
        await client.query(
          'UPDATE termine SET fahrzeug_id=NULL WHERE fahrzeug_id IN (SELECT id FROM fahrzeuge WHERE kunden_id=$1)', [kid]);
        await client.query('DELETE FROM fahrzeuge WHERE kunden_id=$1', [kid]);
        await client.query('DELETE FROM kunden_dokumente WHERE kunden_id=$1', [kid]);
        await client.query('DELETE FROM dsgvo_anfragen WHERE kunden_id=$1', [kid]);
        await client.query('DELETE FROM kunden WHERE id=$1', [kid]);
      });
      await auditLog({ userId: req.user.id, aktion: 'kunde.geloescht',
        tabelle: 'kunden', datensatzId: kid, req });
      res.json({
        message: 'Kundenkonto vollständig gelöscht und archiviert.',
        aufbewahrungspflicht: false,
      });
    }
  } catch (err) { next(err); }
});

module.exports = router;
