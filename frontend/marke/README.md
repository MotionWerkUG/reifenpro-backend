# Wortmarke für Dokumente

`logo-dokument.svg` ist die Wortmarke für gedruckte Dokumente (Einlagerungsschein,
Auslagerungsschein, Vertrag, Datenschutzerklärung, Rechnung): dunkle Schrift auf
weißem Grund, „&" und Unterstrich in Marken-Gold `#eab308`, Untertitel in Grau.
Gleiche Geometrie wie die Wortmarke der Website (`src/lib/homepage-render.js`,
`logoSvg()`), dort nur in der hellen Variante für dunklen Hintergrund.

**Bitte inline in das Dokument-HTML einsetzen**, nicht als externe Datei verlinken:
Gespeicherte Dokumente (`kunden_dokumente.inhalt_html`) sollen auch in Jahren noch
vollständig sein, unabhängig davon, ob eine Bild-URL dann noch erreichbar ist.

Empfohlene Anzeigegröße im Dokumentkopf: `width="196" height="35"`.
Verboten bleibt ein „SS"-Monogramm (siehe DESIGN.md).
