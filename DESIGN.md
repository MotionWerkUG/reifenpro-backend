# Schröder & Scholz — Corporate Identity (DESIGN.md)

Verbindliche Gestaltungsgrundlage für alle Oberflächen und Materialien (Webseite,
Kundenportal, Admin/Werkstatt, Flyer, Rechnungen, E-Mails). Abgeleitet aus der
Live-Webseite (Stand 2026-08-06), nicht erfunden. UI-Änderungen halten sich hieran.

## Marke in einem Satz
Reifenservice und Fahrzeugtechnik — **schnell, fair, zuverlässig**. Sachlich,
handwerklich, aufgeräumt. Hell-dominiert mit kräftigen dunklen Akzentbändern und
**einem** Signalton: Gold.

## Farben

| Rolle | HEX | Verwendung |
|---|---|---|
| Marken-Gold | `#eab308` | Der EINE Akzent: Buttons, „&", Unterstrich, Aktionsbänder, Hervorhebung |
| Gold-Tinte (Schrift auf Gold) | `#171717` | Text/Icons auf goldenen Flächen (nie Weiß auf Gold — schlecht lesbar) |
| Gold-Text auf Hell | `#87680c` | Wenn Gold als Textfarbe auf hellem Grund gebraucht wird (lesbar) |
| Tinte | `#1a1a1a` | Primäre Schrift, Überschriften |
| Near-Black | `#171717` | Dunkle Flächen: Kopfzeile, Foto-Overlays, Kontrastbänder |
| Weiß | `#ffffff` | Grundfläche (hell-first) |
| Grau kräftig | `#555555` | Sekundärtext auf Hell |
| Grau hell (auf Dunkel) | `#cfcfcf` | Subtitle/Sekundärtext auf dunklen Flächen |
| Panel hell | `#f6f7f9` | Karten, Eingabefelder, ruhige Flächen |
| Panel hell 2 | `#eef0f3` | Abgesetzte Flächen, Tabellen-Zebra |
| Linie | `#e3e6ec` | Rahmen, Trenner |

Semantik (getrennt vom Akzent): Erfolg `#1a8f52`, Warnung `#b3781a`, Fehler `#c8402a`,
Info `#2f6bd8`. Gold ist NIE die Fehler-/Erfolgsfarbe.

## Typografie
- **Schrift:** kräftige System-Grotesk — `-apple-system, "Segoe UI", Roboto, Arial, sans-serif`.
  Kein Fremd-Webfont (schnell, datensparsam, DSGVO-neutral).
- **Gewichte:** Überschriften **800**, Labels/Buttons **600–700**, Fließtext **400**.
- **Skala (Web):** H1 ~52px · H2 ~30px · H3 ~20px · Body 15–16px · Label 11–13px
  (Versalien, Laufweite +0.06em).
- Große Headlines dürfen laut sein; Fließtext ruhig, ~60–70 Zeichen breit.

## Wortbild / Logo
- Reine **Wortmarke** „SCHRÖDER & SCHOLZ", das „&" in Gold, darunter der Untertitel
  „REIFENSERVICE UND FAHRZEUGTECHNIK", gefolgt von einem kurzen goldenen Unterstrich.
- Themenadaptiv: Schrift dunkel auf Hell, hell auf Dunkel; „&" und Balken bleiben Gold.
- **Verboten:** ein „SS"-Monogramm (in Deutschland historisch belastet). Kein Icon,
  keine zweite Bildmarke.

## Komponenten
- **Primär-Button:** Gold-Fläche, dunkle Schrift (`#171717`), 600–800, Radius ~8px.
- **Sekundär-Button:** heller Grund, dunkle Schrift, feiner Rahmen.
- **Aktionsband:** goldenes Vollband, dunkle Schrift, ein Code in dunkler „Pille".
- **Badges/Status:** über Semantikfarben (siehe oben), nicht über Gold.
- **Karten:** weißer Grund, feine Linie, großzügiges Padding, wenig Schatten.

## Ton der Texte
- Klar, knapp, konkret. Nutzen zuerst. „Räderwechsel" (nicht „Reifenwechsel"),
  „Reifeneinlagerung", „Fahrwerks-/Bremsenservice".
- **Anrede vereinheitlichen:** aktuell mischt die Seite „du" (Aktionsbanner) und „Sie"
  (Hero, Portal). Empfehlung: durchgängig **Sie** in Portal/Admin/Rechnungen; im
  Marketing (Flyer/Banner) eine bewusste Wahl treffen und dann konsequent halten.
- Echte Umlaute (ä/ö/ü/ß), keine Emojis.

## Do / Don't
- DO: Gold sparsam als Signal; Weiß als Ruhe; Dunkel nur als Akzentband/Foto-Overlay.
- DO: hell als Standard; Dunkelmodus bleibt als Wahlmöglichkeit.
- DON'T: Weiß auf Gold; Verläufe; zweite Akzentfarbe; „SS"-Monogramm; Emojis;
  generische KI-Optik (violett-blaue Verläufe, zentrierte Standard-Hero ohne Grund).
