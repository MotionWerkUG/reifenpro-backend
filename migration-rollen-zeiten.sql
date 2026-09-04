-- Zeitgrenzen je Rolle.
--
-- WARUM JE ROLLE UND NICHT JE PERSON: Die Rolle sagt bereits, was jemand tut und wie viel
-- Schaden ein offener Bildschirm anrichtet. Eine Einstellung je Person waere bei jedem neuen
-- Mitarbeiter eine weitere, die jemand setzen muss und die beim Anlegen vergessen wird.
--
-- ZWEI VERSCHIEDENE UHREN, die man leicht verwechselt:
--  * idle_minuten     -- Untaetigkeit. Wer nichts tut, wird abgemeldet. Das ist die Grenze, die
--                        in der Werkstatt stoert: Tablet am Regal, Haende schmutzig, alle
--                        30 Minuten neu anmelden. NULL oder 0 heisst: kein automatisches Abmelden.
--  * sitzung_stunden  -- Gesamtdauer der Anmeldung, unabhaengig von Aktivitaet. Diese Grenze ist
--                        die versteckte Falle: Ohne sie wuerde ein Werkstattzugang trotz
--                        abgeschaltetem Untaetigkeits-Abmelden nach acht Stunden mitten in der
--                        Schicht herausfliegen.
--
-- WARUM UNTERSCHIEDLICH: Ein Werkstattzugang sieht Tagesliste, Kalender, Lagerplan,
-- Einlagerungen und Kunden nur lesend -- keine Rechnungen, Preise, Einstellungen. Ein
-- unbeaufsichtigtes Tablet in der Werkstatt ist damit ein anderes Risiko als ein
-- unbeaufsichtigter Rechner am Tresen, vor dem ein Kunde steht und auf einen Bildschirm sieht,
-- der alles kann.

ALTER TABLE rollen
  ADD COLUMN IF NOT EXISTS idle_minuten    integer,
  ADD COLUMN IF NOT EXISTS sitzung_stunden integer NOT NULL DEFAULT 10;

COMMENT ON COLUMN rollen.idle_minuten IS
  'Abmelden nach so vielen Minuten ohne Aktivitaet. NULL oder 0 = kein automatisches Abmelden.';
COMMENT ON COLUMN rollen.sitzung_stunden IS
  'Hoechstdauer einer Anmeldung, auch bei durchgehender Arbeit. Deckt eine Schicht ab.';

-- Inhaber: kommt an Rechnungen, Preise und alle Kundendaten; sitzt am Tresen, wo Kunden stehen.
UPDATE rollen SET idle_minuten = 30, sitzung_stunden = 10 WHERE schluessel = 'admin';
-- Werkstatt: kein automatisches Abmelden. Die Schicht endet ueber sitzung_stunden von selbst.
UPDATE rollen SET idle_minuten = NULL, sitzung_stunden = 10 WHERE schluessel = 'mitarbeiter';
