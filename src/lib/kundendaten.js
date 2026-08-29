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

module.exports = { KUNDENTYPEN, strasseHatHausnummer, plzGueltig, pruefeAnschrift, pruefeKundentyp, pruefeRechnungEmail };
