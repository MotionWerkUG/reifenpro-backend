'use strict';
// Gemeinsame Preis-/Dauer-Aufloesung (Staffel je Fahrzeugtyp + Zollgroesse).
// Liegt auf dem Server unter src/lib/preis.js

function resolvePreis(artikel, varianten, typ, zoll) {
  const z = (zoll !== null && zoll !== undefined && zoll !== '') ? parseInt(zoll) : null;
  const passend = (varianten || []).filter(function (v) {
    const typOk = !v.fahrzeug_typ || v.fahrzeug_typ === typ;
    // Zoll-gestaffelte Varianten greifen NUR mit angegebener Zollgroesse im Bereich.
    // Ohne Zollangabe (z===null) darf eine Zoll-Variante nicht matchen (sonst Fehlpreis).
    const hatZollStaffel = (v.zoll_min !== null && v.zoll_min !== undefined) || (v.zoll_max !== null && v.zoll_max !== undefined);
    const zollOk = hatZollStaffel
      ? (z !== null && (v.zoll_min === null || v.zoll_min === undefined || z >= v.zoll_min) && (v.zoll_max === null || v.zoll_max === undefined || z <= v.zoll_max))
      : true;
    return typOk && zollOk;
  }).map(function (v) {
    const hatStaffel = (v.zoll_min !== null && v.zoll_min !== undefined) || (v.zoll_max !== null && v.zoll_max !== undefined);
    const score = (v.fahrzeug_typ ? 2 : 0) + (hatStaffel ? 1 : 0);
    // Breite des Zollbereichs: je enger, desto spezifischer. Offene Enden zaehlen als sehr breit.
    const von = (v.zoll_min === null || v.zoll_min === undefined) ? -Infinity : v.zoll_min;
    const bis = (v.zoll_max === null || v.zoll_max === undefined) ? Infinity : v.zoll_max;
    return { v: v, score: score, breite: bis - von, von: von };
  }).sort(function (a, b) {
    // Ueberlappende Bereiche sind eine Fehlkonfiguration, koennen aber vorkommen (Altdaten,
    // direkter DB-Zugriff). Frueher entschied die Reihenfolge der Datenbankzeilen — dieselbe
    // Konfiguration konnte also verschiedene Preise liefern. Jetzt ist die Auswahl eindeutig:
    // genauere Regel zuerst, bei Gleichstand der engere Bereich, dann die hoehere Untergrenze,
    // zuletzt die ID. Damit ist der Preis reproduzierbar, egal in welcher Reihenfolge die
    // Zeilen ankommen.
    if (b.score !== a.score) return b.score - a.score;
    if (a.breite !== b.breite) return a.breite - b.breite;
    if (b.von !== a.von) return b.von - a.von;
    return String(a.v.id) < String(b.v.id) ? -1 : 1;
  });
  if (passend.length) {
    const v = passend[0].v;
    return { quelle: 'variante', variante_id: v.id, preis: v.preis, mwst_satz: v.mwst_satz, dauer_minuten: v.dauer_minuten != null ? v.dauer_minuten : artikel.dauer_minuten };
  }
  return { quelle: 'basis', preis: artikel.preis, mwst_satz: artikel.mwst_satz, dauer_minuten: artikel.dauer_minuten };
}

module.exports = { resolvePreis };
