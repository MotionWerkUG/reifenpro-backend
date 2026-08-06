# Auftrag: Ein selbst gehostetes Website-CMS bauen (vollständige Spezifikation)

**Zweck dieses Dokuments.** Du (die andere KI bzw. der Entwickler) sollst für eine **bestehende
Kundenwebsite** ein Content-Management-System (CMS) bauen, mit dem der Betreiber die komplette
Startseite **selbst pflegen** kann – Texte, Bilder, Reihenfolge, Navigation, Schriften, Farben,
SEO – **ohne Programmierkenntnisse**. Dieses Dokument beschreibt Aufbau, Datenmodell, API,
Render-Logik, Editor, Bildverarbeitung, Schriften-Upload und Sicherheit **so genau, dass eine
identische, produktionsreife Umsetzung möglich ist**. Weiche nur ab, wenn eine Vorgabe in der
Zielumgebung technisch unmöglich ist – dann begründe die Abweichung.

Das Referenzsystem läuft mit **Node.js/Express + PostgreSQL + nginx + PM2 + sharp** und erzeugt eine
**statische HTML-Datei**. Die Architektur ist portabel (PHP/Laravel, Python/Django usw.). Wo ein
Konzept stack-unabhängig ist, ist es allgemein beschrieben; wo es auf Details ankommt, steht das
konkrete Referenzverhalten.

---

## 0. Verbindliche Grundprinzipien

1. **Statische Ausgabe.** Nach jeder schreibenden Änderung wird die gesamte Startseite **einmal**
   als fertige `index.html` erzeugt und als Datei ausgeliefert. Kein PHP/DB-Zugriff pro Besucher →
   maximale Geschwindigkeit, gute SEO, einfache Absicherung.
2. **Selbst gehostet & datensparsam (DSGVO).** Keine externen CDNs, keine Google Fonts von
   fremden Servern, kein Tracking. Schriften und Bilder liegen auf dem eigenen Server. Externe
   Einbettungen (Karten) erst nach aktiver Zustimmung des Besuchers laden.
3. **Sicherheit zuerst.** Jede vom Nutzer eingegebene Ausgabe wird beim Rendern escaped bzw. gegen
   eine **Whitelist** saniert. Kein `innerHTML` aus ungeprüften Quellen, keine Fremd-URLs, kein
   Pfad-Zugriff außerhalb der Upload-Ordner. Details in Abschnitt 10.
4. **Laien-Editor.** Der Betreiber arbeitet visuell: Bereich anklicken → bearbeiten. Fachbegriffe
   werden erklärt. Jede Speicherung aktualisiert die Seite sofort.
5. **Korrekte Umlaute.** In allen Anzeigetexten, Dokumenten und UI-Texten immer `ä ö ü Ä Ö Ü ß`
   ausschreiben – niemals `ae/oe/ue/ss`. Ausnahme: interne technische Bezeichner (DB-Spalten,
   Code-Variablen) dürfen ASCII bleiben.
6. **Rückgängig statt Angst.** Änderungen an Abschnitten sind über eine Historie widerrufbar.

---

## 1. Platzhalter (zu Projektbeginn festlegen)

| Platzhalter | Bedeutung | Beispiel |
|---|---|---|
| `{{FIRMA}}` | Anzeigename des Kunden | „Muster GmbH" |
| `{{DOMAIN}}` | öffentliche Website-Domain (mit Protokoll) | `https://www.muster.de` |
| `{{ADMIN_DOMAIN}}` | Domain, unter der das CMS läuft | `https://admin.muster.de` |
| `{{WEBROOT}}` | Verzeichnis, aus dem die Website ausgeliefert wird | `/var/www/muster-web` |
| `{{ZIEL_HTML}}` | Pfad der erzeugten Startseite | `{{WEBROOT}}/index.html` |
| `{{UPLOAD_DIR}}` | Server-Ordner für Bild-Uploads | `{{WEBROOT}}/uploads` |
| `{{FONT_DIR}}` | Server-Ordner für Schriften | `{{WEBROOT}}/uploads/fonts` |
| `{{UPLOAD_URL}}` | öffentliche URL-Basis der Uploads | `/uploads` |
| `{{DB}}` | Datenbank + App-Benutzer | Postgres `muster` / `muster_user` |
| `{{AKZENT}}` | Standard-Akzentfarbe der Marke | `#eab308` |
| `{{DUNKEL}}` | dunkle Flächenfarbe (Kopf/Fuß) | `#171717` |
| `{{FONT_STD}}` | Standard-Schrift-Stack | `-apple-system,'Segoe UI',Roboto,Arial,sans-serif` |

**Wichtig:** `{{UPLOAD_URL}}` existiert nur auf `{{DOMAIN}}`, nicht auf `{{ADMIN_DOMAIN}}`. Die
CMS-Vorschau läuft auf der Admin-Domain → für Bild-/Schrift-Vorschau dort **absolute** URLs
(`{{DOMAIN}}{{UPLOAD_URL}}/…`) verwenden (siehe Abschnitt 12).

---

## 2. Fragen an den Auftraggeber, BEVOR du beginnst

1. Welche Abschnittstypen braucht die Seite (siehe Abschnitt 4)? Gibt es zusätzliche?
2. Welche Marke: Standard-Schriften, Akzentfarbe, dunkle Farbe, Logo (Wortmarke als SVG oder Bild)?
3. Welche Firmendaten sollen automatisch in „Öffnungszeiten"/„Kontakt" einfließen (Adresse,
   Telefon, E-Mail, Zeiten, Social-Links, Geo-Koordinaten)?
4. Wohin werden Bilder/Schriften gespeichert (`{{UPLOAD_DIR}}`/`{{FONT_DIR}}`) und unter welcher
   öffentlichen URL (`{{UPLOAD_URL}}`)?
5. Welche Bildbibliothek ist verfügbar (sharp/Node, Intervention Image bzw. GD/PHP, Pillow/Python)?
6. Wird ein Kontaktformular / eine Terminbuchung gebraucht? (optionales Modul, Abschnitt 15)
7. Wie authentifiziert sich der Betreiber (bestehendes Login/JWT übernehmen)?

---

## 3. Architektur-Überblick

Fünf Bausteine:

1. **Datenbank** – Abschnitte, Einstellungen (inkl. Design/SEO/Navigation), Schriften, Historie.
2. **Renderer** – reine Funktion `renderHomepage(sektionen, einstellungen, fonts) → HTML-String`.
   Kennt keine DB, ist voll testbar.
3. **Generator** – lädt Daten, ruft den Renderer, schreibt `{{ZIEL_HTML}}`. Wird nach **jeder**
   schreibenden API-Änderung aufgerufen (`regenerate()`).
4. **Admin-API** – geschützte REST-Endpunkte (nur eingeloggtes Personal), Abschnitt 6.
5. **CMS-Editor** – eine einzelne HTML-Seite (`cms.html`) mit visueller Vorschau (iframe) und
   Einstellungs-Panels, Abschnitt 9.

Datenfluss: **Editor → API → DB → `regenerate()` → statische `index.html` → Besucher.**

---

## 4. Datenmodell

### Tabelle `sektionen` (Kern der Startseite)

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | uuid PK | |
| `typ` | text | einer der Typen unten (CHECK/Whitelist) |
| `sortierung` | int | Reihenfolge (Schritte von 10: 10,20,30 …) |
| `headline` | text | Überschrift |
| `subline` | text | Unterzeile (nur `hero`) |
| `inhalt` | text | Fließtext, ggf. Rich-HTML (Abschnitt 7) |
| `bild_url` | text | `{{UPLOAD_URL}}/…` oder null |
| `bild_alt` | text | Alt-Text des Bildes (SEO/Barrierefreiheit) |
| `cta_text` | text | Button-Text (nur `hero`) |
| `cta_url` | text | Button-Ziel (nur `hero`) |
| `sichtbar` | bool | ein-/ausgeblendet |
| `daten` | jsonb | strukturierte Bausteindaten (FAQ/Kundenstimmen/Galerie) |
| `geaendert_am` | timestamptz | |

**Typen:** `hero` (Kopfbereich mit Hintergrundbild, Überschrift, Unterzeile, Button) ·
`text` (Text + optional Bild, zweispaltig) · `leistung` (Kachel mit Bild/Titel/Text; mehrere
aufeinanderfolgende werden zu einem Karten-Raster gruppiert) · `faq` (Aufklapp-Fragen) ·
`kundenstimmen` (Zitate mit Sternen) · `galerie` (Bildraster) · `oeffnungszeiten` (Tabelle aus
Firmendaten) · `kontakt` (Adresse/Karte/Formular aus Firmendaten). Die letzten zwei sind
„automatisch" – kein freier Text/Bild.

**`daten`-Schemata (jsonb):**
- `faq`: `{ "items": [ { "frage": "…", "antwort": "…" } ] }`
- `kundenstimmen`: `{ "google_url": "https://…", "items": [ { "text": "…", "name": "…", "sterne": 1..5 } ] }`
- `galerie`: `{ "bilder": [ "{{UPLOAD_URL}}/a.jpg", … ] }`

### Tabelle `sektion_historie` (Rückgängig)

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | serial PK | |
| `sektion_id` | uuid | Bezug |
| `daten` | jsonb | vollständiger Vorzustand der Sektion (alle o. g. Inhaltsfelder inkl. `daten`, `bild_alt`) |
| `beschreibung` | text | Anzeige („Über uns") |
| `geaendert_am` | timestamptz | |

Bei jedem `PUT sektionen/:id` wird der **alte** Stand als Snapshot gesichert; nur die letzten **12**
behalten. „Undo" stellt den jüngsten Snapshot wieder her und löscht ihn.

### Tabelle `einstellungen` (genau EIN Datensatz)

Enthält Firmenstammdaten **und** drei jsonb-Felder für das CMS:

- `nav_links` jsonb – Array von `{ label, url, sichtbar, btn }` (Kopf-Navigation).
- `design_config` jsonb – `{ font_head, font_body, akzent, akzent_ink, dunkel, skala }`
  (Typografie/Farben; Details Abschnitt 7).
- `seo_config` jsonb – `{ titel, beschreibung, og_bild }` (SEO-Texte + Social-Vorschaubild).
- Firmendaten (read): `firmenname, strasse, plz, ort, telefon, email, geo_breite, geo_laenge,
  mo_fr_von, mo_fr_bis, sa_offen, sa_von, sa_bis, so_offen, …, facebook_url, instagram_url,
  google_bewertung_url`.
- Aktionsbanner: `aktion_aktiv, aktion_text, aktion_code, aktion_position, aktion_link`.

### Tabelle `fonts` (hochgeladene Schriften)

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | uuid PK | |
| `label` | text | Anzeigename im CMS |
| `familie` | text | eindeutiger CSS-`font-family`-Name (z. B. `Montserrat-a1b2`) |
| `datei` | text | Dateiname unter `{{FONT_DIR}}` |
| `format` | text | `woff2` \| `woff` \| `truetype` \| `opentype` |
| `erstellt_am` | timestamptz | |

> **Stolperstein:** Wird eine neue Tabelle als DB-Superuser angelegt, fehlen dem App-Benutzer die
> Rechte („permission denied"). Nach dem Anlegen **immer** `GRANT SELECT,INSERT,UPDATE,DELETE`
> an `{{DB}}`-App-Benutzer vergeben.

---

## 5. Firmendaten & automatische Abschnitte

`oeffnungszeiten` und `kontakt` werden aus `einstellungen` erzeugt – nicht frei editierbar:
- Öffnungszeiten als Tabelle (Mo–Fr, Sa, So – nur wenn hinterlegt).
- Kontakt: Adresskarte + Telefon/E-Mail-Links + **Karten-Platzhalter mit Zustimmungsklick**
  (Karte erst nach Klick laden, Datenschutzhinweis anzeigen) + Kontaktformular (Honeypot-Feld
  gegen Spam, Pflicht-Datenschutz-Häkchen).

---

## 6. Admin-API (alle Endpunkte)

Alle Endpunkte **authentifiziert** (nur eingeloggtes Personal, z. B. JWT im `Authorization: Bearer`).
Basis-Pfad im Referenzsystem: `/api/homepage`. **Nach jeder schreibenden Änderung an Sektionen,
Banner, Navigation, Design, SEO oder Schriften: `regenerate()` aufrufen** (statische Seite neu
schreiben).

### Sektionen
- `GET /sektionen` → alle, nach `sortierung`.
- `POST /sektionen` `{ typ }` → legt Abschnitt an (Standard-Überschrift je Typ; strukturierte Typen
  starten mit leerem `daten`). Validiert `typ` gegen Whitelist.
- `PUT /sektionen/:id` `{ headline, subline, inhalt, bild_url, bild_alt, cta_text, cta_url,
  sichtbar, daten, buchung_artikel_id? }` → speichert; sichert vorher Snapshot in `sektion_historie`
  (max 12). `daten` wird **typspezifisch** validiert/begrenzt (Abschnitt 6a).
- `DELETE /sektionen/:id` → löschen.
- `POST /sektionen/:id/move` `{ dir: "up"|"down" }` → tauscht `sortierung` mit Nachbar.
- `POST /sektionen/:id/duplicate` → kopiert den Abschnitt inkl. `daten`/`bild_alt` mit
  `sortierung+1` und Titel „Kopie: …". `hero` und automatische Typen **verweigern** (400).
- `GET /sektionen-historie` → letzte 5 Snapshots (für Undo-Anzeige).
- `POST /sektionen-undo` → jüngsten Snapshot wiederherstellen (inkl. `daten`/`bild_alt`), Snapshot löschen.

### 6a. `daten`-Validierung (Pflicht, serverseitig)
- `faq`: Array `items` auf max. 40; je Eintrag `frage` (≤200), `antwort` (≤2000); leere Fragen filtern.
- `kundenstimmen`: `google_url` nur wenn `^https?://`; `items` max 40; `text` (≤600), `name` (≤80),
  `sterne` auf **0..5 begrenzen** (clampen).
- `galerie`: `bilder` max 60; **nur** Einträge, die auf `^{{UPLOAD_URL}}/[\w.\-/]+$` passen
  (keine Fremd-URLs).

### Bild-Upload
- `POST /bild` `{ data: "data:image/…;base64,…", format: "hero"|"inhalt" }` → validiert MIME
  (png/jpeg/webp/gif/heic/heif), verarbeitet (Abschnitt 8), speichert als `.jpg`, gibt
  `{ url: "{{UPLOAD_URL}}/img-….jpg" }` zurück.

### Medien-Übersicht
- `GET /medien` → Liste aller Bilddateien in `{{UPLOAD_DIR}}` (ohne Unterordner `fonts`):
  `{ datei, url, groesse, benutzt, mtime }`. `benutzt` = kommt in `sektionen.bild_url`,
  `galerie.daten.bilder`, `seo_config.og_bild` (oder optional Buchungsleistungen) vor.
- `DELETE /medien/:datei` → löscht Datei. **Dateiname streng whitelisten**
  (`^[\w.\-]+\.(jpe?g|png|webp|gif)$`, kein `..`), Zielpfad muss innerhalb `{{UPLOAD_DIR}}` liegen.

### Design / Typografie
- `GET /design` → `design_config` gemischt mit Standardwerten.
- `PUT /design` `{ font_head, font_body, akzent, akzent_ink, dunkel, skala }` →
  **font-family säubern** (nur `[\w\s,'"().\-]`, max 300 Zeichen → keine CSS-Injektion),
  Farben nur `^#[0-9a-fA-F]{3,8}$`, `skala` auf `0.7..1.6` clampen. Speichern + `regenerate()`.

### Schriften
- `GET /fonts` → alle.
- `POST /fonts` `{ label, data: "data:font/…;base64,…" }` → **Format an der Datei-Signatur prüfen**
  (Magic Bytes, Abschnitt 9), max 3 MB, Datei nach `{{FONT_DIR}}` schreiben, eindeutige `familie`
  bilden, Zeile speichern, `regenerate()`.
- `DELETE /fonts/:id` → Zeile + Datei löschen, `regenerate()`.

### SEO
- `GET /seo` → `seo_config`.
- `PUT /seo` `{ titel, beschreibung, og_bild }` → Titel/Beschreibung **HTML entfernen** +
  Längenbegrenzung (≤120 / ≤320), `og_bild` nur `^{{UPLOAD_URL}}/…` (keine Fremd-URL). `regenerate()`.

### Navigation & Banner
- `GET/PUT /nav` → Array `{ label(≤40), url(≤300), sichtbar, btn }`, max 12, min 1. `regenerate()`.
- `GET/PUT /banner` → Aktionsbanner-Felder; `aktion_position ∈ {leiste, ecke-links, ecke-rechts}`. `regenerate()`.

---

## 7. Render-Logik (Renderer)

Reine Funktion, erzeugt eine **vollständige** HTML-Seite. Reihenfolge im `<head>`:
`charset`, `viewport`, `<title>`, `meta description`, `robots`, `canonical`,
OpenGraph (`og:title/description/url/image` + `image:width/height` + `site_name/locale`),
Twitter-Card, Favicons, **JSON-LD** (LocalBusiness/entsprechend), dann `<style>` mit dem
kompletten CSS, dann `<body>`.

`<body>`-Reihenfolge: Aktionsbanner → `<header>` (Wortmarke/Logo + Navigation) → `<main>` mit den
sichtbaren Sektionen nach `sortierung` → `<footer>` (Logo, Social-Icons, Rechtslinks) →
Editor-Bridge-Skript (Abschnitt 12).

### 7a. CSS-Variablen-System (Kern der Anpassbarkeit)

Ganz oben im `<style>` ein `:root` aus `design_config` erzeugen, **danach** das statische CSS, das
**ausschließlich** über diese Variablen Farben/Schriften/Größen bezieht:

```
:root{
  --accent: {akzent};        /* Akzent (Buttons, Links, Hervorhebungen) */
  --accent-ink: {akzent_ink};/* Textfarbe AUF Akzentflächen */
  --dark: {dunkel};          /* dunkle Flächen: Kopf-/Fußzeile, Buchungsbereich */
  --font-head: {font_head};  /* Überschriften */
  --font-body: {font_body};  /* Fließtext + Navigation */
  --sc: {skala};             /* globale Schriftgrößen-Skalierung, Standard 1 */
}
body{ font-family:var(--font-body); font-size:calc(16px*var(--sc)); … }
h1,h2,h3{ font-family:var(--font-head); }
```

**Regeln für das statische CSS:**
- Jedes `#AKZENT` → `var(--accent)`. Jede Textfarbe, die **auf** Akzent liegt (Button-Text) →
  `var(--accent-ink)`. Jede **dunkle Fläche** (Nav-BG, Footer-BG) → `var(--dark)`.
- Jede lesbare Schriftgröße als `calc(<px>*var(--sc))`; bei `clamp()` die Min-/Max-Werte
  einzeln mit `*var(--sc)` multiplizieren.
- **Standardwerte** so wählen, dass die Seite ohne gespeicherte `design_config` **exakt** wie das
  ursprüngliche Design aussieht (Abwärtskompatibilität).

### 7b. Eigene Schriften einbinden

Vor `:root` für **jede** hochgeladene Schrift ein `@font-face` erzeugen (selbst gehostet):

```
@font-face{ font-family:'<familie>'; src:url('{{UPLOAD_URL}}/fonts/<datei>') format('<format>'); font-display:swap }
```

Im CMS speichert man als `font_head`/`font_body` entweder einen eingebauten Stack **oder**
`'<familie>', -apple-system, Arial, sans-serif`. Da alle `@font-face` immer ausgegeben werden, greift
jede referenzierte Familie.

### 7c. Sicheres Rich-Text-Rendering (PFLICHT)

`inhalt` und FAQ-`antwort` dürfen einfache Formatierung enthalten. **Niemals** roh ausgeben.
Verfahren „escapen, dann Whitelist wiederherstellen" (alles Nicht-Erlaubte bleibt escaped → XSS
unmöglich):

```
richHtml(s):
  wenn s keine der Tags <b|strong|i|em|u|a|ul|ol|li|p|br> enthält:
      return escape(s) mit \n → <br>        // Alt-Klartext
  e = escape(s)                               // < > & " werden zu Entities
  e = e ersetze &lt;(/?)(b|strong|i|em|u|ul|ol|li|p)&gt; → <$1$2>
  e = e ersetze &lt;br ...&gt; → <br>
  e = e ersetze &lt;a href=&quot;(URL)&quot;&gt;:
        URL entescapen; nur zulassen wenn ^(https?://|mailto:|tel:|/|#)
        sonst „" (Tag verwerfen, Text bleibt)
        sonst → <a href="escape(URL)" target="_blank" rel="noopener">
  e = e ersetze &lt;/a&gt; → </a>
  return e
```

Attribute außer dem geprüften `href` werden nie wiederhergestellt → `onclick`, `style`, `<script>`,
`<img onerror>` bleiben als harmloser Text stehen.

### 7d. Section-Renderer (je Typ)
- `hero`: `<section>` mit `background-image: linear-gradient(dunkel-overlay), url(bild)`, Überschrift,
  Unterzeile, optional Button (`var(--accent)`).
- `text`: zweispaltig, `<div class="rt">richHtml(inhalt)</div>` + optional Bild rechts
  (`alt = bild_alt || headline`, `loading="lazy"`, feste `width/height` gegen Layout-Shift).
- `leistung`: aufeinanderfolgende zu Karten-Raster gruppieren; Karte = Bild + Nummer + Titel +
  `richHtml`.
- `faq`: `<details class="faq-i"><summary>frage</summary><div>richHtml(antwort)</div></details>`.
- `kundenstimmen`: Karten mit Sterne-Reihe (`sterne` gefüllt/leer), Zitat, Name; optional
  „Bei Google bewerten"-Button aus `google_url`.
- `galerie`: responsives Bildraster (`object-fit:cover`, `aspect-ratio`, `loading="lazy"`,
  Alt = „<headline> N").
- `oeffnungszeiten`/`kontakt`: aus Firmendaten (Abschnitt 5).

Hilfsfunktionen: `esc()` (HTML-Escape), `absUrl()` (relativ → `{{DOMAIN}}` absolut, für OG-Bild),
`sterneHtml(n)` (n auf 0..5 clampen).

---

## 8. Bildverarbeitung

Jedes hochgeladene Bild serverseitig **zuschneiden (cover, mittig, kein Verzerren)** und
komprimieren. Zielformate:
- `hero`: 1600×760 (breites Kopfbild, ca. 21:10) – auch für OG-/Social-Vorschaubild.
- `inhalt`: 900×675 (4:3) – Text-/Leistungs-/Galeriebilder.

EXIF-Ausrichtung beachten (Handyfotos rotieren), Ausgabe als JPEG (Qualität ~82, mozjpeg).
Referenz: `sharp` (Node). Alternativen: Intervention Image/GD (PHP), Pillow (Python).

---

## 9. Schriften-Upload

- Erlaubt: WOFF2, WOFF, TTF, OTF. Empfehlung an den Nutzer: **WOFF2** (klein).
- **Format an Magic Bytes prüfen** (nicht an der Endung):
  `wOF2`→woff2 · `wOFF`→woff · `OTTO`→opentype · `true`/`ttcf` oder `00 01 00 00`→truetype.
  Passt nichts → 400 ablehnen. Max 3 MB.
- Datei nach `{{FONT_DIR}}` schreiben; `familie` eindeutig bilden (z. B. Label bereinigt +
  kurzer Zeitstempel-Suffix), damit zwei Schriften nicht kollidieren.
- Selbst gehostet ausliefern (`{{UPLOAD_URL}}/fonts/…`) – **kein** externer Font-Dienst.

---

## 10. Sicherheit (nicht verhandelbar)

1. **XSS:** `richHtml` (7c) serverseitig beim Rendern **und** eine Client-Bereinigung im Editor
   (nur erlaubte Tags aus dem contenteditable-DOM übernehmen). Der Renderer ist die letzte Instanz.
2. **CSS-Injektion:** `font_head/font_body` auf `[\w\s,'"().\-]` beschränken; Farben nur `#hex`;
   `skala` numerisch clampen. Diese Werte werden roh in `:root` geschrieben.
3. **URL-Whitelisting:** Links nur mit sicherem Schema (`https?`/`mailto`/`tel`/`/`/`#`);
   `og_bild` und Galerie-Bilder nur eigene `{{UPLOAD_URL}}`-Pfade.
4. **Pfad-Traversal:** Datei-Löschen/-Schreiben nur mit strengem Namens-Whitelist; Zielpfad muss
   nachweislich innerhalb `{{UPLOAD_DIR}}`/`{{FONT_DIR}}` liegen.
5. **Auth:** alle Admin-Endpunkte nur für eingeloggtes Personal.
6. **DSGVO:** keine externen CDNs/Fonts/Tracker; Karten erst nach Zustimmung; Datenschutz-Link
   im Kontaktformular.
7. **Upload-Prüfung:** Bild-MIME und Font-Signatur prüfen; Größenlimits.

---

## 11. CMS-Editor (Frontend `cms.html`)

Eine einzelne HTML-Seite, zwei Ansichten (Umschalter oben):

**A) Visuelle Vorschau.** `<iframe src="{{DOMAIN}}/?editor=1">`. In der erzeugten Seite ist im
Editor-Modus ein Skript aktiv, das Klicks auf `[data-sektion-id]` abfängt und
`postMessage({type:'cms-edit', id})` an das CMS sendet → CMS öffnet den passenden Bearbeiten-Dialog.
Zusätzlich Umschalter **Desktop/Mobil** (iframe-Breite 100 % vs. ~390 px).

**B) Einstellungen & Listen.** Panels (Reihenfolge frei, empfohlen):
1. **Design & Schriften:** Schrift-Upload (Datei→DataURL→`POST /fonts`) + Liste mit Löschen;
   Auswahl Überschrift-/Fließtext-Schrift (eingebaute Stacks **plus** eigene); Regler Basis-Größe
   (70–160 %); Farbwähler Akzent / Text-auf-Akzent / dunkle Fläche. **Sofort-Vorschau** (Mini-Box,
   die Kopf/Überschrift/Text/Button live in den gewählten Werten zeigt) + **Live-Update der großen
   Vorschau** per `postMessage({type:'cms-design', vars})` + **Kontrast-Warnung** (Abschnitt 11a).
2. **SEO & Vorschau:** Seitentitel, Meta-Beschreibung (Zeichenzähler ~60/155), Social-Vorschaubild
   (Upload als `hero`-Format), **Google-Snippet-Vorschau**.
3. **Aktionsbanner**, **Navigation** (Menüpunkte hinzufügen/sortieren/„als Button"),
   **Medien-Übersicht** (Bilder mit „benutzt/frei" + Löschen).
4. **Abschnitte:** Liste mit Aufklappen, sichtbar-Schalter, Sortierpfeilen, **Duplizieren**,
   Löschen; „+"-Buttons für jeden Typ.

**Bearbeiten-Dialog je Typ:**
- `hero/text/leistung`: Überschrift, ggf. Unterzeile, **Rich-Text-Editor** (contenteditable +
  Werkzeugleiste Fett/Kursiv/Listen/Link/Format entfernen), Bild-Upload, **Alt-Text-Feld**.
- `faq/kundenstimmen/galerie`: wiederholbare Item-Editoren (Frage/Antwort · Zitat/Name/Sterne ·
  Bilder mit Upload/Entfernen). Speichert `daten`.
- `leistung` optional: Verknüpfung zu einer Buchungsleistung (nur wenn Buchungsmodul vorhanden).

**Verhalten:** Bild-Upload = FileReader→DataURL→`POST /bild`→URL in verstecktes Feld + Vorschau.
Nach Speichern Dialog schließen, Liste + Vorschau neu laden. Undo-Button ruft `POST /sektionen-undo`.

### 11a. Kontrast-Warnung (WCAG)
Relative Luminanz je Farbe berechnen, Kontrastverhältnis
`(hell+0.05)/(dunkel+0.05)`. Warnen (nicht blockieren), wenn **Akzent-Text/Akzent** oder
**weiß/dunkle Fläche** unter **4.5** liegt.

---

## 12. Vorschau-Editor-Bridge (postMessage-Protokoll)

- **iframe → CMS:** `{type:'cms-edit', id}` beim Klick auf einen Bereich (nur im `?editor=1`-Modus).
- **CMS → iframe:** `{type:'cms-design', vars:{accent, accent_ink, dunkel, font_head, font_body, sc}}`
  → das Seiten-Skript setzt die CSS-Variablen live via `document.documentElement.style.setProperty`
  (Live-Vorschau ohne Speichern).
- **Herkunft prüfen:** Empfänger akzeptiert nur Nachrichten von der eigenen Domain-Familie.
- **Bild-Vorschau über Domaingrenze:** Im CMS (Admin-Domain) für Thumbnails absolute
  `{{DOMAIN}}{{UPLOAD_URL}}/…`-URLs bauen, da `/uploads` dort nicht existiert.

---

## 13. Deployment & Betrieb

- Statische Seite wird bei jeder Änderung nach `{{ZIEL_HTML}}` geschrieben; Webserver liefert sie
  direkt aus. `{{UPLOAD_URL}}` und `{{UPLOAD_URL}}/fonts` müssen vom Webserver ausgeliefert werden.
- Backend-Codeänderung → Prozess neu starten (Referenz: `pm2 restart <app>`).
- DB-Migrationen idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) + **Grants**
  für neue Tabellen an den App-Benutzer.

---

## 14. Abnahme-Checkliste (so testen)

Design/Schriften: Standard = unverändertes Ausgangsdesign · Farbe/Schrift/Größe ändern wirkt in
`index.html` · Font-Upload erzeugt `@font-face` und Datei ist per HTTPS erreichbar · Löschen entfernt
beides · ungültige Farbe/Injektionsversuch wird gesäubert.
SEO: Titel/Beschreibung/OG editierbar; HTML wird entfernt; Fremd-URL als OG abgelehnt; leer = Standard.
Inhalte: Rich-Text `<b>` bleibt, `<script>/onerror/onclick/javascript:` werden neutralisiert;
Alt-Text landet im `alt`; FAQ/Kundenstimmen/Galerie rendern; Sterne 9 → 5; Galerie-Fremd-URL gefiltert.
Komfort: Duplizieren kopiert Inhalt (Hero/Auto 400); Medienliste erkennt „benutzt"; Medien-Löschen
mit `../` → 400; Mobil-Umschalter; Live-Vorschau + Kontrast-Warnung.
Allgemein: Undo stellt Vorzustand her; Sortieren/Ein-Ausblenden wirkt; Umlaute korrekt;
keine externen Requests im Quelltext.

---

## 15. Optionale Module (nur wenn gewünscht)

- **Kontaktformular:** `POST /kontakt` mit Honeypot + Datenschutz-Häkchen; serverseitige
  Validierung; Speicherung/Mail.
- **Terminbuchung:** eigener Assistent (`/termin/`), Leistungen mit Dauer, freie Slots aus einem
  Kalender; Gast-Buchung mit Bestätigungsmail. Ist **domänenspezifisch** und nicht Teil des
  Kern-CMS – nur bei Bedarf und getrennt spezifizieren.

---

## 16. Stolpersteine (aus der Praxis)

- **Zeitzonen:** `new Date('YYYY-MM-DD')` wird als UTC interpretiert → in UTC+1/+2 der Vortag.
  Immer `T12:00:00` anhängen oder aus getFullYear/Month/Date bauen.
- **DB-Grants:** neue Tabelle = neue Rechte für den App-Benutzer, sonst „permission denied".
- **Uploads-Domaingrenze:** Vorschau-Bilder/Fonts im CMS absolut adressieren (Abschnitt 12).
- **contenteditable:** je Browser andere Tags (b/strong, div/p) → Client-Bereinigung auf Whitelist
  normalisieren; der Server-Sanitizer bleibt letzte Instanz.
- **@font-face-Reihenfolge:** immer alle Schriften ausgeben, unabhängig davon, welche gewählt ist.
- **Layout-Shift:** Bildern feste `width/height` bzw. `aspect-ratio` geben, `loading="lazy"`.
- **Umlaute:** in allen Anzeige-/Dokumenttexten `ä ö ü ß` ausschreiben.

---

*Diese Spezifikation beschreibt ein vollständiges, produktionsreifes Website-CMS mit
Baukasten-Abschnitten, komplett steuerbarer Typografie/Farbe, SEO-Feintuning, sicherem Rich-Text,
Medienverwaltung und Live-Vorschau. Bei korrekter Umsetzung ist das Ergebnis gegenüber gängigen
Baukästen technisch überlegen (Tempo, Datenschutz, Sicherheit) und für Laien bedienbar.*
