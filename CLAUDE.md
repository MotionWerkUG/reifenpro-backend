# ReifenPro — Projektkontext für Claude Code

## Betrieb & Standort (Stand 2026-08-06 — Modell A)

- **Code lebt auf dem Server:** `/home/deploy/projekte/reifenpro` (Standardstruktur, git-versioniert).
- **Entwicklung:** Claude Code Desktop-App, per SSH mit dem Server verbunden, Ordner `reifenpro` waehlen.
- **Laeuft als:** PM2-Prozess `reifenpro` aus `src/server.js` (Port aus .env). PM2 `sandumotion` NIE anfassen.
- **Parallele Sessions = getrennte Worktrees:** Pro Bereich ein eigener Arbeitsordner (git worktree) neben dem Hauptordner — `reifenpro-homepage`, `reifenpro-portal`, `reifenpro-admin`, `reifenpro-rechnungen`. Der Hauptordner `reifenpro` ist `main` und dient nur als Deploy-/Integrationsordner (nicht direkt drin entwickeln). Landkarte + Anleitung: `.claude/bereiche/LANDKARTE.md`.
- **Deploy Backend:** Bereichs-Branch nach `main` mergen, dann im Hauptordner `pm2 restart reifenpro`.
- **Deploy Frontend:** liegt in `frontend/`; nach Aenderung nach `/var/www/reifenpro/` kopieren (`cp`, ggf. `sudo`; nginx bedient das statisch). Portal: `frontend/portal/` nach `/var/www/reifenpro/portal/`.
- **Kein Staging:** eigener Einzelbetrieb → es wird direkt auf Prod deployt; darum vor jedem Deploy strikt `/release-gate`.
- **GitHub:** Haupt-/Integrationsbranch `main`. Alt-Backup: `/var/www/reifenpro-backend` (inaktiv, NICHT dorthin deployen).
- **Geschaeftsdaten** (rechnungen/, protokoll-dateien/, gewerbe-dokumente/) liegen im Projektordner und sind per .gitignore ausgeschlossen — niemals nach GitHub.

---


## Was ist das

ReifenPro ist ein Reifenservice-Verwaltungssystem für die Firma **Schröder & Scholz**
(Reifenservice und Fahrzeugtechnik). Der Inhaber (David) ist Entwickler, Eigentümer und
Nutzer in einem. Geplant: später evtl. als Produkt für andere Reifendienste (Multi-Tenant),
aber ERST muss der eigene Betrieb laufen — nicht vorzeitig einbauen.

Geschäft: Kunden lagern Winter-/Sommerreifen ein (Einlagerung), Räderwechsel (NICHT
“Reifenwechsel” = Neukauf). Ein Kunde kann mehrere Fahrzeuge haben (DB noch nicht umgesetzt).

## Stack & Infrastruktur

- Server: 161.97.187.239 (Contabo VPS, Ubuntu 24.04)
- Backend: Node.js/Express, Port 3001, PM2-Prozess “reifenpro” (ID 1)
- **PM2-Prozess “sandumotion” (ID 0) NIEMALS anfassen** — anderes Projekt
- DB: PostgreSQL 16, Datenbank “reifenpro”
- DB-Zugriff NUR via `sudo -u postgres psql -d reifenpro` (NICHT reifenpro_user — peer auth schlägt fehl)
- Proxy: nginx, Config unter /etc/nginx/sites-available/reifenpro
  - /reifenpro/api/ -> Port 3001
  - /reifenpro/ -> /var/www/reifenpro/ (Frontend)
  - /reifenpro/portal/ -> Kundenportal
- Frontend Admin: /var/www/reifenpro/index.html — API-Pfad /reifenpro/api
- Backend-Source (aktiv): /home/deploy/projekte/reifenpro/src/ (Modell A). Das alte /var/www/reifenpro-backend ist inaktives Backup.
- GitHub: github.com/MotionWerkUG/reifenpro-backend (Standardstruktur: src/, frontend/)

## Deployment (Modell A — Code liegt auf dem Server)

- Gearbeitet wird im Bereichs-Worktree; zum Deployen den Branch nach `main` mergen.
- Backend: im Hauptordner `/home/deploy/projekte/reifenpro` `pm2 restart reifenpro`.
- Frontend: Datei aus `frontend/` nach `/var/www/reifenpro/` kopieren (`cp`, ggf. `sudo`;
  Portal nach `/var/www/reifenpro/portal/`). CMS-Website zusaetzlich neu generieren (siehe `.claude/bereiche/homepage/`).
- KEIN curl-Deploy von GitHub mehr, NICHT nach `/var/www/reifenpro-backend` (inaktiv).

## FIRMENPRINZIPIEN (strikt)

- KEINE Emojis in Code oder Antworten
- Umlaute IMMER korrekt (ä/ö/ü, nicht ae/oe/ue) in Anzeigetext und generierten Dokumenten.
  ABER interne DB-Spaltennamen (reifen_groesse) und Typschlüssel (datenschutzerklaerung) bleiben.
- Kennzeichen IMMER Format WOR-AB-1234 (4 getrennte Felder: 3 Zeichen, 2, 4 Ziffern, 1 Buchstabe)
- Reifendimension: 205/55 R16 91W
- Werkstatt/Etikett: Kundenname nur als Kürzel OHNE Vokale (z.B. “A.Gbry”)
- Lagerplatz möglichst prominent (Etikett riesig, Werkstatt orange/gelb hervorgehoben)
- NIEMALS behaupten etwas sei behoben ohne verifizierbare Bestätigung
- Bei Frontend-Lieferung IMMER den cp-Deploy-Befehl (nach /var/www/reifenpro/) automatisch mitschicken

## Marke / Design

- **Hierarchie (wer steht wo):** Über allem steht die Firma **Schröder & Scholz** — Davids
  eigener Reifenservice-Betrieb, für den ReifenPro gebaut wird. Nach außen (Website,
  Kundenportal) tritt AUSSCHLIESSLICH „Schröder & Scholz" auf. **ReifenPro** ist nur der
  interne Anwendungsname (Admin/Werkstatt). **Allit Solutions** ist Davids
  Software-Anbietermarke im Hintergrund und taucht kundenseitig NICHT auf.
- Firmenname: Schröder & Scholz (im Kundenportal NUR dieser Name)
- ReifenPro = Name der Anwendung (nur im Admin/Werkstatt-Bereich)
- Untertitel im Logo: “Reifenservice und Fahrzeugtechnik”
- Admin-Frontend: Orange-Akzent (#e8502a) — bleibt
- Kundenportal: Schwarz-Gelb (Akzent #eab308) — passend zum Logo
- Logo ist eine reine Wortmarke “SCHRÖDER & SCHOLZ” mit gelbem &-Zeichen, KEIN Icon
  (Wichtig: KEIN “SS”-Monogramm — historisch belastet in Deutschland)

## Aktueller Stand (Juni 2026)

Fertig, teils noch zu deployen/testen:

- Admin (index.html): Dashboard, Kunden, Einlagerung, Lagerplan, Kalender (Monat/Woche/Tag),
  Werkstatt, Statistik, Mitarbeiter, DSGVO, Einstellungen, Etikettendruck (A7), Live-Uhr
- Kundenportal (portal.html): zweisprachig DE/EN, Registrierung mit automatischer
  Kundenverknüpfung, Login, Passwort-Reset, Einlagerungen ansehen, Termine buchen/stornieren
- datenschutz.html + agb.html (zweisprachig, laden Firmendaten dynamisch)
- Backend-Routen: portal-auth.js, portal-daten.js, termine.js
- cron-erinnerungen.js (48h-Terminerinnerung, Saison 1.Okt/Apr, HU-Warnung)

## Bekannte Stolpersteine / Learnings

- Zeitzonenbug: new Date(‘YYYY-MM-DD’) wird als UTC interpretiert -> in UTC+2 der Vortag.
  IMMER + ‘T12:00:00’ anhängen oder direkt aus getFullYear/getMonth/getDate bauen.
- Race Conditions: API ist async, renderXY() darf nicht vor Datenankunft laufen.
  Immer sofort rendern UND nach API-Antwort nochmal.
- Safari Passwort-Manager: Login als <div>, NICHT <form> (sonst kein Vorschlag).
- termine-Tabelle: termin_typ-CHECK-Constraint wurde entfernt (erlaubt freie Artikelnamen);
  NOT NULL auf kontakt_name/telefon/email/kennzeichen entfernt (anonyme Termine).
- Artikel müssen dauer_minuten gesetzt haben um im Portal buchbar zu sein.

## Offen / To-do

- Rechnungserstellung (Phase 4) — gesetzeskonform (GoBD, Pflichtangaben nach § 14 UStG,
  fortlaufende Rechnungsnummer, 8 Jahre Aufbewahrung). NEU bauen.
- Mehrere Fahrzeuge pro Kunde (DB-Erweiterung)
- Einstellungen-Layout-Feinschliff (war Grund für Wechsel zu Claude Code)
- Noch nicht abgeschlossen vom Inhaber: Firmendaten + Artikel-Preise eintragen,
  AV-Verträge IONOS + Contabo, AGB anwaltlich prüfen

## Rechtliches (Bayern, nicht-öffentlich)

- Aufsichtsbehörde: BayLDA, Promenade 18, 91522 Ansbach, [poststelle@lda.bayern.de](mailto:poststelle@lda.bayern.de)
- Aufbewahrung: Rechnungen/Belege 8 Jahre, Verträge 8 Jahre ab Ende, Korrespondenz 6 Jahre
- Auftragsverarbeiter: Contabo (Hosting), IONOS (E-Mail) — AV-Verträge nötig

## Design
UI-Aenderungen halten sich an DESIGN.md (Corporate Identity, aus der Live-Webseite abgeleitet).

## Bereiche (getrennte Sessions)
ReifenPro ist in vier Bereiche geteilt: Homepage/CMS, Kundenportal, Admin/Werkstatt, Rechnungswesen. Landkarte + Einstieg: `.claude/bereiche/LANDKARTE.md`. Pro Session einen Bereich; Agents/Skills liegen zentral in `.claude/` und sind ueberall verfuegbar.
