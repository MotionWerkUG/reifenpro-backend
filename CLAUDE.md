# ReifenPro — Projektkontext für Claude Code

## Betrieb & Standort (Stand 2026-08-06 — Modell A)

- **Code lebt auf dem Server:** `/home/deploy/projekte/reifenpro` (Standardstruktur, git-versioniert).
- **Entwicklung:** Claude Code Desktop-App, per SSH mit dem Server verbunden, Ordner `reifenpro` waehlen.
- **Laeuft als:** PM2-Prozess `reifenpro` aus `src/server.js` (Port aus .env). PM2 `sandumotion` NIE anfassen.
- **Deploy Backend:** `git pull` dann `pm2 restart reifenpro`.
- **Deploy Frontend:** liegt in `frontend/`; nach Aenderung nach `/var/www/reifenpro/` kopieren (nginx bedient das statisch). Portal: `frontend/portal/` nach `/var/www/reifenpro/portal/`.
- **GitHub:** Branch `server-standard` (neue Standardstruktur). Alt-Backup: `/var/www/reifenpro-backend` (inaktiv).
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
- Backend-Source: /var/www/reifenpro-backend/src/
- GitHub: github.com/MotionWerkUG/reifenpro-backend (Dateien im ROOT des Repos)

## Deployment

- HTML/Frontend: über GitHub, dann curl auf Server nach /var/www/reifenpro/
- Backend/DB: direkt auf Server
- Frontend-Deploy-Befehl (Admin):
  curl -L -o /var/www/reifenpro/index.html “<https://raw.githubusercontent.com/MotionWerkUG/reifenpro-backend/main/index.html>”
- Nach Backend-Änderung: pm2 restart reifenpro

## FIRMENPRINZIPIEN (strikt)

- KEINE Emojis in Code oder Antworten
- Umlaute IMMER korrekt (ä/ö/ü, nicht ae/oe/ue) in Anzeigetext und generierten Dokumenten.
  ABER interne DB-Spaltennamen (reifen_groesse) und Typschlüssel (datenschutzerklaerung) bleiben.
- Kennzeichen IMMER Format WOR-AB-1234 (4 getrennte Felder: 3 Zeichen, 2, 4 Ziffern, 1 Buchstabe)
- Reifendimension: 205/55 R16 91W
- Werkstatt/Etikett: Kundenname nur als Kürzel OHNE Vokale (z.B. “A.Gbry”)
- Lagerplatz möglichst prominent (Etikett riesig, Werkstatt orange/gelb hervorgehoben)
- NIEMALS behaupten etwas sei behoben ohne verifizierbare Bestätigung
- Bei Frontend-Lieferung IMMER den curl-Deploy-Befehl automatisch mitschicken

## Marke / Design

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
