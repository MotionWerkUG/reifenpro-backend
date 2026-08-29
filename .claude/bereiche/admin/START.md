> ## STECKBRIEF — ZUERST LESEN (Stand 2026-08-28)
>
> - **Bereich:** Admin/Werkstatt. **Feste Session-Adresse:** `admin`.
> - **Arbeite im Worktree** `/home/deploy/projekte/reifenpro/admin` — NIE im Hauptordner `/home/deploy/projekte/reifenpro` (sonst instabile Session-Namen; der Hauptordner ist nur Deploy/Integration).
> - **Deine Zuständigkeit:** Admin/Werkstatt-App (frontend/index.html): Dashboard/Kunden/Einlagerung/Lager/Kalender/Werkstatt, Artikel-CRUD + Preise + online-buchbar/rolle, Einstellungen/Firmendaten, DSGVO, Mitarbeiter, termine.js.
> - **Was in eine andere Session gehört + Routing bei Überschneidungen:** `.claude/bereiche/SESSIONS.md` (verbindlich).
> - **Andere Sessions erreichen:** SendMessage an `homepage` / `portal` / `admin` / `rechnungswesen`; vorher ggf. `ListAgents` prüfen.
> - **Landkarte/Worktree-Modell:** `.claude/bereiche/LANDKARTE.md`. **Projektkontext:** `CLAUDE.md` (Hauptordner) + `.claude/bereiche/admin/CLAUDE.md`. **Dauerfakten:** Memory.
> - **Deploy:** Bereichs-Branch → `main` mergen → `sudo pm2 restart reifenpro` (Backend läuft aus main). Frontend: `frontend/index.html` nach `/var/www/reifenpro/index.html` kopieren (NICHT `/var/www/schroeder-homepage/` — das ist die öffentliche Website und gehört der Homepage-Session).
> - **Vor Freigabe:** Qualitäts-Gate (code-auditor/breaker/reviewer, ggf. gobd-pruefer/produkt-kritiker) + `/release-gate`.

# Kickoff: Admin / Werkstatt

Ordner **`/home/deploy/projekte/reifenpro/admin`** in Claude Code öffnen (eigener
Worktree für diesen Bereich, NICHT den Sammelordner `reifenpro`), dann als erste Nachricht:

> Lies `.claude/bereiche/admin/CLAUDE.md` und den Admin-Abschnitt von
> `.claude/bereiche/DEEP-TEST-2026-08-26.md` (aktueller als `AUDIT-2026-08-06.md`). Wir arbeiten
> ausschließlich am Bereich Admin/Werkstatt (Rechnungen sind separat). Beginne mit dem ersten
> offenen Punkt unten — die Aufgaben 1-5 des alten Audits sind erledigt. Vor Deploy `/release-gate`.

## Erledigt und live (Stand 2026-08-28, verifiziert)

Die ursprünglichen Aufgaben 1-5 aus dem Audit sind umgesetzt, deployt und nachgeprüft — **nicht
erneut anfangen**. Nachweis: 30 API-Prüfungen + 18 Löschpfad-Prüfungen + 14 Browser-Prüfungen
gegen eine isolierte Umgebung (DB `reifenpro_qa`, zweite Instanz auf Port 3099, SMTP ins Leere).

1. Räderwechsel als eine Aktion am Werkstattbrett (`raederwechsel()`/`rwAbholen()`): alter Satz
   „Abgeholt + montiert" → Termin automatisch erledigt → neuer Satz mit frei gewordenem Platz
   vorbefüllt. Satzwahl bei mehreren Sätzen ohne Vorauswahl (Fehlklick-Schutz).
2. Ganzjahr/Allwetter einlagerbar (Formular, Filter, Dashboard, DB-CHECK).
3. Walk-in ohne Termin am Werkstattbrett (`walkIn()`, heutiges Datum + Uhrzeit vorbefüllt).
4. Lagerplatz ändern per Modal (`platzAendern()`), kein `prompt()` mehr; belegter Platz 409,
   Doppelbelegung auch bei abweichender Schreibweise blockiert.
5. Härtung: DSGVO-Löschung transaktional inkl. FK-Entkopplung (S5), `termine.js` durchgängig
   `requireStaff` (S8), Letzter-Admin-Schutz mit `FOR UPDATE` (S9), Dummy-Hash beim Admin-Login.
   Ebenfalls erledigt: Status-Flow Eingelagert → Abholbereit → Abgeholt (offener Punkt aus dem
   Deep-Test vom 26.08.).
6. Löschen einer Einlagerung: `requireAdmin`, transaktional mit `FOR UPDATE`, 409 mit Klartext
   statt FK-Fehler, wenn Protokolle, unterschriebene Dokumente oder eine Folge-Einlagerung
   daran hängen. Unbekannter Reifentyp liefert 400 statt 500.
7. Öffnungszeiten: `PUT /api/einstellungen/oeffnungszeiten` nutzt `pruefeWoche()` +
   `wocheSpeichern()` aus `src/lib/oeffnung.js` — dieselbe Quelle wie das CMS-Panel. Damit sind
   die falsche Sa/So-Schließzeit bei Mittagspause und die still auf „geschlossen" kippende
   Teilwoche behoben.
8. Upload-Limit in `src/server.js` aufgeteilt (mit allen Bereichen abgestimmt): global `1mb`;
   `/api/homepage/bild` 40mb, `/api/homepage/fonts` 5mb, `/api/protokolle` 25mb,
   `/api/gewerbe` 25mb (Portal-Formular), `/api/einstellungen` 10mb (Firmenlogo),
   `/api/kunden/:id/dokumente` 25mb (Scan als Data-URL im Dokument).
9. Protokoll-Dateien (Fotos, Unterschriften, PDFs) liegen im aktiven Projekt statt im inaktiven
   Alt-Ordner `/var/www/reifenpro-backend/` und sind damit im nächtlichen Backup.

## Offen (priorisiert)

1. **Geschäftsentscheidung David — SUV/Transporter-Aufschlag wirkungslos.** `artikel_preise` hat
   keine Zeile mit `fahrzeug_typ`; die Mechanik (`preis.js`) existiert. Entweder Aufschläge
   eintragen oder das Feld ausblenden, statt einen Preis zu versprechen, den es nicht gibt.
2. Modale schließen nicht per Escape (nur die Suche) — im Werkstattalltag lästig.
3. `DELETE /api/einlagerungen/:id` ist gehärtet, hat aber keinen Einstieg im Frontend. Entweder
   einen Lösch-Knopf ergänzen (Admin-only) oder bewusst als reine API-Route belassen.
4. Weitere Admin-Punkte des Deep-Tests siehe `../DEEP-TEST-2026-08-26.md` (Abschnitte Admin).
   Bereits abgehakt: `gewerbe.js`-Freitext escapen, Rollen-Validierung in `users.js`,
   Dummy-Hash in `auth.js`, `einstellungen.js` GET nur für Personal.

## Prüfumgebung (statt Tests auf Prod)

Es gibt kein Staging. Für Admin-Tests darum eine isolierte Kopie bauen statt auf der Live-DB zu
arbeiten: DB `reifenpro_qa` (`pg_dump -s reifenpro` + Konfigtabellen), zweite Instanz mit
kopierter `.env` (eigener Port, `DB_NAME=reifenpro_qa`, `SMTP_HOST=127.0.0.1`/`SMTP_PORT=1`, damit
kein Mailversand passiert), Oberfläche über einen kleinen Static-Server mit `/api`-Proxy.
Damit sind auch Löschung, Letzter-Admin-Sperre und Abholbereit-Mail gefahrlos prüfbar.

Definition of Done: deployt, in Hell/Dunkel gesichtet, PM2-Logs sauber, Commit + Push.
