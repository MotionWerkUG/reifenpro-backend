-- Rollen und Rechte.
--
-- AUSGANGSLAGE: Es gab zwei fest verdrahtete Rollen ('admin', 'mitarbeiter') und die Regel
-- "Mitarbeiter darf alles ausser dem, was ausdruecklich requireAdmin traegt". Gemessen: Ein
-- Mitarbeiter erreichte 132 von 163 geschuetzten Stellen, darunter ALLE 32 der
-- Website-Verwaltung, 16 im Rechnungswesen und 13 in der Kundenverwaltung. Die Rolle war damit
-- nicht beschrieben durch das, was sie braucht, sondern durch eine Liste von 31 Ausnahmen.
--
-- JETZT: Je Bereich eine von drei Stufen -- kein / ansehen / bearbeiten. Was nicht ausdruecklich
-- erlaubt ist, ist gesperrt (Minimalprinzip). Die Navigation folgt daraus: Stufe 'kein' blendet
-- den Menuepunkt aus UND sperrt den Aufruf. Ein zweiter Schalter fuer Sichtbarkeit waere eine
-- zweite Wahrheit -- dieselbe Falle wie doppelt gepflegte Oeffnungszeiten.
--
-- users.rolle bleibt als Textschluessel unveraendert ('admin', 'mitarbeiter'), damit kein
-- Bestandsdatensatz angefasst werden muss; rollen.schluessel ist die Verbindung.

CREATE TABLE IF NOT EXISTS rollen (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  schluessel   text UNIQUE NOT NULL,
  name         text NOT NULL,
  beschreibung text,
  -- Systemrollen lassen sich nicht loeschen. Der Inhaber laesst sich zusaetzlich nicht
  -- einschraenken: sonst gaebe es den Fall, in dem niemand mehr hineinkommt.
  system       boolean NOT NULL DEFAULT false,
  vollzugriff  boolean NOT NULL DEFAULT false,
  erstellt_am  timestamptz DEFAULT now(),
  geaendert_am timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rollen_rechte (
  rolle_id uuid NOT NULL REFERENCES rollen(id) ON DELETE CASCADE,
  bereich  text NOT NULL,
  stufe    text NOT NULL CHECK (stufe IN ('kein','ansehen','bearbeiten')),
  PRIMARY KEY (rolle_id, bereich)
);

-- Einzelne Befugnisse, die sich mit "ansehen/bearbeiten" nicht sauber abbilden lassen.
-- Eine Rechnung schreiben ist etwas anderes, als sie unwiderruflich festzuschreiben.
CREATE TABLE IF NOT EXISTS rollen_befugnisse (
  rolle_id uuid NOT NULL REFERENCES rollen(id) ON DELETE CASCADE,
  befugnis text NOT NULL,
  PRIMARY KEY (rolle_id, befugnis)
);

INSERT INTO rollen (schluessel, name, beschreibung, system, vollzugriff) VALUES
  ('admin', 'Inhaber', 'Vollzugriff. Lässt sich nicht einschränken und nicht sperren.', true, true),
  ('mitarbeiter', 'Werkstatt', 'Alles für den Tag am Fahrzeug. Nichts, was Preise, Belege oder die Außendarstellung berührt.', true, false)
ON CONFLICT (schluessel) DO NOTHING;

-- Werkstatt: nur was fuer den Tag am Fahrzeug gebraucht wird.
INSERT INTO rollen_rechte (rolle_id, bereich, stufe)
SELECT r.id, v.bereich, v.stufe FROM rollen r, (VALUES
  ('werkstatt','bearbeiten'), ('kalender','bearbeiten'), ('lagerplan','bearbeiten'),
  ('einlagerungen','bearbeiten'), ('kunden','ansehen'),
  ('dashboard','kein'), ('kontaktanfragen','kein'), ('gewerbeanfragen','kein'),
  ('rechnungen','kein'), ('artikel','kein'), ('gutscheine','kein'), ('statistik','kein'),
  ('website','kein'), ('datenschutz','kein'), ('einstellungen','kein')
) AS v(bereich, stufe)
WHERE r.schluessel='mitarbeiter'
ON CONFLICT (rolle_id, bereich) DO NOTHING;

INSERT INTO rollen_befugnisse (rolle_id, befugnis)
SELECT id, 'etikett_drucken' FROM rollen WHERE schluessel='mitarbeiter'
ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON rollen, rollen_rechte, rollen_befugnisse TO reifenpro_user;
