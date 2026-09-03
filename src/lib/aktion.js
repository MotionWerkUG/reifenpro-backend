'use strict';
// Prueft, ob ein Aktionsbanner mit Gutschein-Code ueberhaupt beworben werden darf.
//
// Warum es diese Datei gibt: Der Banner-Code ist Freitext in `einstellungen` und war an die
// Tabelle `gutscheine` nicht gebunden. Laeuft der beworbene Code ab (WINTER2026 endet am
// 31.10.2026), bewirbt die Startseite ihn weiter, der Kunde klickt, der Code steht vorbelegt im
// Assistenten — und die Buchung weist ihn zurueck. Ein angezeigter und dann verweigerter Rabatt
// ist der unangenehmste Fall; deshalb wird beim Erzeugen der Seite geprueft, nicht nur beim
// Speichern im CMS.
//
// Die Bedingung ist woertlich dieselbe wie in src/routes/gast.js (GET /gast/gutschein/:code) —
// also genau das, was der Buchungsassistent dem Kunden als gueltig anzeigt. Sie steht bewusst
// nur hier, damit Generator, Preisseite und CMS nicht auseinanderlaufen koennen.
const { query } = require('../db/index');

const CODE_GUELTIG_SQL =
  'aktiv=true AND (gueltig_bis IS NULL OR gueltig_bis >= CURRENT_DATE) AND rabatt_prozent > 0 AND rabatt_prozent <= 100';

function normCode(c) { return String(c || '').trim().toUpperCase().replace(/\s+/g, ''); }

// Liefert den Gutschein-Datensatz, wenn er beworben werden darf, sonst null.
async function bewerbbarerGutschein(code) {
  const c = normCode(code);
  if (!c) return null;
  const { rows } = await query(
    'SELECT code, rabatt_prozent, gueltig_bis FROM gutscheine WHERE UPPER(code)=UPPER($1) AND ' + CODE_GUELTIG_SQL,
    [c]);
  return rows[0] || null;
}

// Entscheidet fuer eine geladene `einstellungen`-Zeile, ob das Banner ausgespielt wird.
// Ist ein Code hinterlegt, der nicht mehr gilt, wird das GANZE Banner ausgesetzt — nicht nur
// der Code entfernt. Grund: Der Text bewirbt den Nachlass ("25 % auf Einlagerung ... Ihr Code:")
// und endet ohne Code auf einem leeren Doppelpunkt. Ein Banner, das einen Rabatt verspricht,
// den es nicht mehr gibt, ist schlechter als gar keins. Ein Banner OHNE Code bleibt unberuehrt.
// Rueckgabe: { zeigen: bool, grund: null|'kein-banner'|'code-ungueltig', code: string|null }
async function bannerStatus(f) {
  if (!f || f.aktion_aktiv !== true || !f.aktion_text) return { zeigen: false, grund: 'kein-banner', code: null };
  if (!f.aktion_code) return { zeigen: true, grund: null, code: null };
  const g = await bewerbbarerGutschein(f.aktion_code);
  if (!g) return { zeigen: false, grund: 'code-ungueltig', code: f.aktion_code };
  return { zeigen: true, grund: null, code: g.code };
}

// ── Abgleich der Prozentzahlen im Bannertext mit dem Gutschein ──────────────────────────
// Davids Entscheidung (03.09.2026): Nennt der Text einen Satz, den der Gutschein nicht hergibt,
// laesst sich das Banner gar nicht erst speichern. Beworbene 30 %, die die Buchung nie gewaehrt,
// sind eine falsche Preisangabe — die darf nicht erst dem Kunden auffallen.
//
// Bewusst NICHT geprueft wird Vollstaendigkeit: "25 % auf die Einlagerung" ist erlaubt, obwohl
// der Gutschein zusaetzlich 10 % auf alles andere gibt. Sonst muesste jeder Bannertext saemtliche
// Saetze aufzaehlen — werblich schlecht und nicht das Ziel der Regel.

// Alle Saetze, die ein Gutschein hergibt: Basissatz aus `gutscheine` plus jede Regel aus
// `gutschein_regeln` (artikel_id NULL = Auffangsatz). Der gestaffelte Fall ist der wichtige:
// WINTER2026 gibt 25 % auf die Einlagerung und 10 % auf alles Uebrige.
async function saetzeFuerCode(code) {
  const c = normCode(code);
  if (!c) return [];
  const g = (await query('SELECT id, rabatt_prozent FROM gutscheine WHERE UPPER(code)=UPPER($1)', [c])).rows[0];
  if (!g) return [];
  const regeln = (await query('SELECT rabatt_prozent FROM gutschein_regeln WHERE gutschein_id=$1', [g.id])).rows;
  const menge = new Set();
  if (g.rabatt_prozent != null) menge.add(Number(g.rabatt_prozent));
  regeln.forEach((r) => { if (r.rabatt_prozent != null) menge.add(Number(r.rabatt_prozent)); });
  return Array.from(menge).sort((a, b) => b - a);
}

// Prozentzahlen aus einem Text: "25 %", "25%", "25 Prozent". Komma-Werte werden mitgelesen,
// damit "25,5 %" nicht unbemerkt durchrutscht.
//
// Zwei Vorbehandlungen, beide aus einem Angriffsversuch entstanden:
// 1. NFKC-Normalisierung. "30％" mit dem Vollbreiten-Prozentzeichen (U+FF05) oder "３０ %" mit
//    Vollbreiten-Ziffern sah auf der Seite aus wie "30 %", rutschte aber durch \d und %, weil
//    beide nur ASCII treffen. NFKC bildet solche Zeichen auf ihre ASCII-Form ab.
// 2. Spitze Klammern entfernen. "30<!---->%" trennte Ziffer und Zeichen so, dass \s* nicht mehr
//    griff. Fuer die Anzeige ist das harmlos (der Text wird escaped und die Zeichen waeren
//    sichtbar), fuer die Pruefung nicht — also vorher wegnehmen.
function prozenteImText(text) {
  const roh = String(text || '').normalize('NFKC').replace(/<[^>]*>/g, '');
  const treffer = roh.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:%|Prozent)/gi) || [];
  return treffer.map((t) => Number(String(t).replace(/[^\d.,]/g, '').replace(',', '.')));
}

// Rueckgabe: Fehlertext (deutsch, mit konkreten Zahlen) oder null.
async function pruefeBannerText(text, code) {
  const imText = prozenteImText(text);
  if (!imText.length) return null;              // kein Prozentwert -> nichts abzugleichen
  const c = normCode(code);
  if (!c) return null;                          // ohne Gutschein gibt es keinen Sollwert
  const saetze = await saetzeFuerCode(c);
  if (!saetze.length) return null;              // Code unbekannt -> faengt bewerbbarerGutschein ab
  const falsch = imText.filter((p) => !saetze.some((s) => s === p));
  if (!falsch.length) return null;
  const liste = (arr, einheit) => arr.map((x) => String(x).replace('.', ',') + ' ' + einheit).join(' und ');
  return 'Im Text steht ' + liste(falsch, '%') + ', der Gutschein ' + c + ' gibt ' + liste(saetze, '%') + ' her.';
}

module.exports = { CODE_GUELTIG_SQL, normCode, bewerbbarerGutschein, bannerStatus, saetzeFuerCode, prozenteImText, pruefeBannerText };
