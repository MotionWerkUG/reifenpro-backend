const router = require('express').Router();
const { execFileSync } = require('child_process');
const path = require('path');
const { ohneGeheimnisse } = require('../lib/kundendaten');
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

// Anfragen kommen nicht nur ueber das Portal, sondern auch am Telefon, per Brief oder am
// Tresen. Bisher gab es dafuer keinen Weg: Das Frontend rief POST /dsgvo auf, die Route
// existierte aber nicht — die Anfrage war damit nirgends erfasst und die Frist nach
// Art. 12 Abs. 3 DSGVO (ein Monat) lief unbemerkt.
const DSGVO_TYPEN = ['auskunft', 'export', 'loeschung', 'berichtigung', 'einschraenkung', 'widerruf', 'widerspruch'];

router.post('/', authenticate, requireStaff, async (req, res, next) => {
  try {
    const { kunden_id, typ, nachricht } = req.body || {};
    if (!kunden_id || !/^[0-9a-fA-F-]{36}$/.test(String(kunden_id)))
      return res.status(400).json({ error: 'Kunde fehlt oder ist ungültig.' });
    const t = String(typ || '').toLowerCase();
    if (!DSGVO_TYPEN.includes(t))
      return res.status(400).json({ error: 'Unbekannte Art der Anfrage.', erlaubt: DSGVO_TYPEN });
    const k = (await query('SELECT id FROM kunden WHERE id=$1', [kunden_id])).rows[0];
    if (!k) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    const { rows } = await query(
      `INSERT INTO dsgvo_anfragen (kunden_id, typ, status, nachricht)
       VALUES ($1, $2, 'offen', $3) RETURNING *`,
      [kunden_id, t, nachricht ? String(nachricht).slice(0, 2000) : null]
    );
    await auditLog({ userId: req.user.id, aktion: 'dsgvo.anfrage_erfasst',
      tabelle: 'dsgvo_anfragen', datensatzId: rows[0].id, neueWerte: rows[0], req });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.get('/auskunft/:kundenId', authenticate, requireStaff, async (req, res, next) => {
  try {
    const kid = req.params.kundenId;
    // Art. 15 verlangt ALLE zu der Person gespeicherten Daten. Bisher fehlten Fahrzeuge,
    // Termine, Rechnungen und Kontaktanfragen — eine unvollstaendige Auskunft ist selbst ein
    // Verstoss. Spalten sind einzeln aufgezaehlt, damit keine internen Token mitgehen
    // (termine.bestaetigung_token) und keine internen Notizen zu Dritten.
    const [k, einl, docs, anf, fz, trm, rech, prot, kpreise] = await Promise.all([
      query('SELECT * FROM kunden WHERE id=$1', [kid]),
      query('SELECT beleg_nr,reifen_groesse,reifen_typ,lagerplatz,status,eingelagert_am FROM einlagerungen WHERE kunden_id=$1', [kid]),
      query('SELECT typ,titel,erstellt_am,unterschrift_datum FROM kunden_dokumente WHERE kunden_id=$1', [kid]),
      query('SELECT typ,status,erstellt_am FROM dsgvo_anfragen WHERE kunden_id=$1', [kid]),
      query('SELECT typ,marke,modell,kennzeichen,baujahr,hu_datum,notiz,erstellt_am FROM fahrzeuge WHERE kunden_id=$1 ORDER BY erstellt_am', [kid]),
      query(`SELECT datum,uhrzeit_von,uhrzeit_bis,termin_typ,kennzeichen,beschreibung,status,
                    portal_buchung,storniert_am,erstellt_am
               FROM termine WHERE kunden_id=$1 ORDER BY datum DESC`, [kid]),
      query(`SELECT rechnungsnr,status,rechnungsdatum,leistungsdatum,faelligkeit,
                    netto_summe,mwst_summe,brutto_summe,zahlungsstatus,bezahlt_am
               FROM rechnungen WHERE kunden_id=$1 ORDER BY rechnungsdatum DESC`, [kid]),
      // Werkstatt-Protokolle sind Daten UEBER die Person (Fahrzeugzustand, Maengel,
      // Kilometerstand, Unterschrift) und gehoeren damit in die Auskunft. Art. 15 kennt
      // keine Unterscheidung zwischen "intern" und "fuer den Kunden bestimmt".
      // Dateipfade zu Fotos und PDF bleiben draussen: Sie sind kein Inhalt, sondern ein
      // Speicherort — stattdessen wird die Anzahl genannt, damit der Kunde weiss, dass es
      // sie gibt und sie anfordern kann.
      query(`SELECT typ, kennzeichen, km_stand, maengel, unterschrift_name, erstellt_am,
                    COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(fotos)='array' THEN fotos ELSE '[]'::jsonb END),0) AS anzahl_fotos,
                    (pdf_pfad IS NOT NULL) AS pdf_vorhanden,
                    checkliste
               FROM protokolle WHERE kunden_id=$1 ORDER BY erstellt_am DESC`, [kid]),
      // Persoenliche Sonderpreise sind eine auf die Person bezogene Information.
      query(`SELECT a.name AS leistung, p.preis
               FROM kunden_preise p JOIN artikel a ON a.id = p.artikel_id
              WHERE p.kunden_id=$1 ORDER BY a.name`, [kid]),
    ]);
    if (!k.rows.length) return res.status(404).json({ error: 'Kunde nicht gefunden.' });
    // Kontaktanfragen haengen nicht am Kundendatensatz, sondern nur an der E-Mail-Adresse.
    const mails = [k.rows[0].email, k.rows[0].portal_email, k.rows[0].rechnung_email]
      .filter(Boolean).map(function (m) { return String(m).toLowerCase(); });
    const kontakt = mails.length
      ? (await query('SELECT name,email,telefon,nachricht,erledigt,erstellt_am FROM kontakt_anfragen WHERE LOWER(email) = ANY($1::text[]) ORDER BY erstellt_am DESC', [mails])).rows
      : [];

    // Auch die Auskunft nach Art. 15 darf keine gueltigen Einmal-Token enthalten: die Datei
    // wird ausgedruckt und verschickt, ein darin stehender Reset-Token waere ein Nachschluessel.
    const kunde = ohneGeheimnisse(k.rows[0]);

    const auskunft = {
      generiert_am: new Date().toISOString(),
      rechtsgrundlage: 'Art. 15 DSGVO',
      gespeicherte_daten: {
        stammdaten: kunde,
        fahrzeuge: fz.rows,
        einlagerungen: einl.rows,
        termine: trm.rows,
        rechnungen: rech.rows,
        dokumente: docs.rows,
        werkstatt_protokolle: prot.rows,
        persoenliche_preise: kpreise.rows,
        kontaktanfragen: kontakt,
        dsgvo_anfragen: anf.rows,
      },
      hinweis_nicht_enthalten: 'Interne Notizen zu Dritten sowie technische Zugangsdaten '
        + '(Passwort, Einmal-Token) sind nach Art. 15 Abs. 4 DSGVO nicht Bestandteil der Auskunft.',
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
          portal_reset_token=NULL, portal_reset_ablauf=NULL,
          portal_bestaetigung_token=NULL, portal_token_ablauf=NULL,
          einwilligung_token=NULL, einwilligung_token_ablauf=NULL,
          portal_freigegeben=false, portal_email_bestaetigt=false,
          anonymisiert_am=NOW(), geloescht_am=NOW()
         WHERE id=$1`,
        [kid]
      );
      // Vorsorglich: Der Kundenportal-Reset laeuft ueber kunden.portal_reset_token (oben schon
      // genullt), die Tabelle wird heute nur fuer Mitarbeiter-Logins gefuellt. Sollte sie
      // spaeter auch fuer Kunden genutzt werden, bleibt hier kein gueltiger Einmal-Link liegen.
      await query('DELETE FROM passwort_reset_tokens WHERE kunden_id=$1', [kid]);
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
