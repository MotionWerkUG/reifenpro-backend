'use strict';
// Gemeinsame Regeln fuer Kundenstammdaten (Privat-/Firmenkunde, Anschrift).
// Bewusst an EINER Stelle, damit Admin, Portal und Rechnung dieselbe Regel anwenden —
// abgestimmt zwischen den Bereichen Admin, Homepage und Rechnungswesen.

const KUNDENTYPEN = ['privat', 'firma'];

// Anschrift-Pruefung bewusst locker: eine Ziffer irgendwo in der Strasse ODER "Postfach".
// "12a", "12-14", "12/3", "Haus 4" sind damit gueltig. Eine strengere Regel wuerde ehrliche
// Adressen abweisen, und ein Vertrag scheitert dann an der Software statt am Kunden.
function strasseHatHausnummer(strasse) {
  const s = String(strasse == null ? '' : strasse);
  return /\d/.test(s) || /postfach/i.test(s);
}

function plzGueltig(plz, land) {
  const p = String(plz == null ? '' : plz).trim();
  if ((land || 'DE').toUpperCase() === 'DE') return /^\d{5}$/.test(p);
  return p.length > 0 && p.length <= 12;
}

// Rueckgabe: null oder { fehler, code }. `pflicht` steuert, ob eine fehlende Anschrift ueberhaupt
// beanstandet wird — beim Anlegen eines Laufkunden ist sie verzichtbar, beim Einlagerungsvertrag nicht.
//
// Zwei Haerten, bewusst unterschieden:
//   HART  — fehlende oder halbe Anschrift, unplausible PLZ. Das ist immer ein Fehler.
//   WEICH — Strasse ohne Hausnummer (code 'HAUSNUMMER'). Es gibt echte Adressen ohne Hausnummer
//           ("Am Markt" in kleinen Orten). Eine Sperre wuerde ehrliche Kunden aussperren, also
//           fragt der Aufrufer einmal nach und laesst es auf Bestaetigung durch.
function pruefeAnschrift({ strasse, plz, ort, land }, pflicht) {
  const leer = (v) => String(v == null ? '' : v).trim() === '';
  if (leer(strasse) && leer(plz) && leer(ort)) {
    return pflicht ? { fehler: 'Straße, PLZ und Ort werden benötigt (für Einlagerungsvertrag und Rechnung).', code: 'ANSCHRIFT_FEHLT' } : null;
  }
  if (leer(strasse) || leer(plz) || leer(ort))
    return { fehler: 'Bitte die Anschrift vollständig angeben: Straße, PLZ und Ort.', code: 'ANSCHRIFT_UNVOLLSTAENDIG' };
  if (!plzGueltig(plz, land)) return { fehler: ((land || 'DE').toUpperCase() === 'DE')
    ? 'Die PLZ muss fünf Ziffern haben.'
    : 'Die PLZ ist ungültig.', code: 'PLZ_UNGUELTIG' };
  if (!strasseHatHausnummer(strasse))
    return { fehler: 'In der Straße steht keine Hausnummer. Trotzdem so übernehmen?', code: 'HAUSNUMMER', weich: true };
  return null;
}

// Firmenkunde: der Firmenname IST der Rechnungsempfaenger (§ 14 UStG). Vorname/Nachname
// bleiben der Ansprechpartner und duerfen ihn nicht ersetzen.
function pruefeKundentyp({ kundentyp, firma }) {
  const typ = String(kundentyp || 'privat').toLowerCase();
  if (!KUNDENTYPEN.includes(typ)) return { fehler: 'Kundentyp muss „privat“ oder „firma“ sein.' };
  if (typ === 'firma' && String(firma == null ? '' : firma).trim() === '')
    return { fehler: 'Bei einem Firmenkunden ist der Firmenname Pflicht (er steht als Empfänger auf der Rechnung).' };
  return { typ };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function pruefeRechnungEmail(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  return EMAIL_RE.test(s) ? null : 'Die Rechnungs-E-Mail ist ungültig.';
}

// Geheimnisse, die nie in eine API-Antwort gehoeren. Betroffen war bisher jede Antwort mit
// "SELECT k.*": darin steckten der bcrypt-Hash des Portalkontos UND gueltige Einmal-Token
// (Passwort-Reset, E-Mail-Bestaetigung, Einwilligung). Wer die Liste sehen konnte — jeder
// angemeldete Mitarbeiter, jede zwischengespeicherte Antwort — haette damit ein fremdes
// Kundenkonto uebernehmen koennen, ohne die E-Mail des Kunden zu lesen.
const GEHEIM = ['portal_password', 'portal_reset_token', 'portal_reset_ablauf',
  'portal_bestaetigung_token', 'portal_token_ablauf',
  'einwilligung_token', 'einwilligung_token_ablauf'];

function ohneGeheimnisse(zeile) {
  if (!zeile) return zeile;
  if (Array.isArray(zeile)) return zeile.map(ohneGeheimnisse);
  const k = Object.assign({}, zeile);
  GEHEIM.forEach(function (f) { delete k[f]; });
  return k;
}


// ── Fahrzeug-Stammfelder am Kunden spiegeln ───────────────────────────────────────────────────
//
// Die Kunden-Tabelle traegt aus der Zeit vor der Fahrzeugliste noch kennzeichen, fahrzeug_marke,
// fahrzeug_modell und hu_datum. Diese Felder sind heute nur noch RUECKFALL: termine.js und
// protokolle.js greifen darauf zurueck, wenn der Vorgang selbst kein Kennzeichen traegt, und die
// Einlagerungsliste zeigt sie an. Nicht mehr daran haengen: die HU-Erinnerung (laeuft seit dem
// Fuhrpark-Umbau ueber fahrzeuge.hu_datum, siehe server.js) und die Kundensuche (sucht bereits
// mit EXISTS ueber fahrzeuge.kennzeichen).
//
// BISHER wurde immer das ZULETZT gepflegte Fahrzeug gespiegelt. Bei zwei Autos sah der Kunde in
// seinem Profil nur noch das zweite -- fuer ihn wie Datenverlust, obwohl beide gespeichert sind
// (von der Portal-Sitzung am 09.09.2026 nachgemessen).
//
// DIE REGEL JETZT:
//   genau ein Fahrzeug  -> spiegeln, der Rueckfall bleibt warm
//   zwei oder mehr      -> Stammfelder LEEREN
//
// Warum leeren und nicht einfrieren: Ein eingefrorener Stamm liefert den Rueckfaellen weiterhin
// ein Kennzeichen -- nur eben das falsche. Auf einem Arbeitsprotokoll stuende dann das Auto, das
// nicht in der Halle steht. Ein leeres Feld ist sichtbar leer, ein falsches nicht. Die Fahrzeuge
// selbst bleiben unangetastet; Admin und Portal zeigen sie aus der Fahrzeugliste.
async function spiegleFahrzeugInStamm(query, kundenId) {
  const anzahl = parseInt((await query('SELECT count(*)::int AS n FROM fahrzeuge WHERE kunden_id=$1', [kundenId])).rows[0].n, 10);
  if (anzahl === 1) {
    const f = (await query('SELECT kennzeichen, marke, modell, hu_datum, erstzulassung FROM fahrzeuge WHERE kunden_id=$1', [kundenId])).rows[0];
    await query(
      `UPDATE kunden SET kennzeichen=$1, fahrzeug_marke=$2, fahrzeug_modell=$3,
              hu_datum=COALESCE($4, hu_datum), erstzulassung=COALESCE($5, erstzulassung)
        WHERE id=$6`,
      [f.kennzeichen || null, f.marke || null, f.modell || null, f.hu_datum || null, f.erstzulassung || null, kundenId]);
    return { gespiegelt: true, anzahl };
  }
  if (anzahl > 1) {
    await query('UPDATE kunden SET kennzeichen=NULL, fahrzeug_marke=NULL, fahrzeug_modell=NULL WHERE id=$1', [kundenId]);
    return { gespiegelt: false, anzahl };
  }
  return { gespiegelt: false, anzahl };   // gar kein Fahrzeug -> Stamm unangetastet lassen
}

module.exports = { spiegleFahrzeugInStamm, ohneGeheimnisse, KUNDENTYPEN, strasseHatHausnummer, plzGueltig, pruefeAnschrift, pruefeKundentyp, pruefeRechnungEmail };
