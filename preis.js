'use strict';
// Gemeinsame Preis-/Dauer-Aufloesung (Staffel je Fahrzeugtyp + Zollgroesse).
// Liegt auf dem Server unter src/lib/preis.js

function resolvePreis(artikel, varianten, typ, zoll) {
  const z = (zoll !== null && zoll !== undefined && zoll !== '') ? parseInt(zoll) : null;
  const passend = (varianten || []).filter(function (v) {
    const typOk = !v.fahrzeug_typ || v.fahrzeug_typ === typ;
    const zollOk = z === null || ((v.zoll_min === null || z >= v.zoll_min) && (v.zoll_max === null || z <= v.zoll_max));
    return typOk && zollOk;
  }).map(function (v) {
    const score = (v.fahrzeug_typ ? 2 : 0) + ((v.zoll_min !== null || v.zoll_max !== null) ? 1 : 0);
    return { v: v, score: score };
  }).sort(function (a, b) { return b.score - a.score; });
  if (passend.length) {
    const v = passend[0].v;
    return { quelle: 'variante', variante_id: v.id, preis: v.preis, mwst_satz: v.mwst_satz, dauer_minuten: v.dauer_minuten != null ? v.dauer_minuten : artikel.dauer_minuten };
  }
  return { quelle: 'basis', preis: artikel.preis, mwst_satz: artikel.mwst_satz, dauer_minuten: artikel.dauer_minuten };
}

module.exports = { resolvePreis };
