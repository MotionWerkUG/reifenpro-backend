-- Die zehn Alt-Spalten der Oeffnungszeiten aus `einstellungen` entfernen.
--
-- WARUM: Sie waren eine zweite Wahrheit ueber dieselbe Sache und konnten das Wochenraster nie
-- vollstaendig abbilden -- EIN Mo-Fr-Block mit Montag als Stellvertreter, und die Mittagspause
-- fiel je nach Leseweg weg. Gemessen am heutigen Stand haetten sie "08:00-18:00" behauptet
-- statt "08:00-12:00 und 13:00-18:00": Ein Kunde waere um halb eins vor verschlossener Tuer
-- gestanden. Einzige Quelle ist ab jetzt die Tabelle `oeffnungszeiten`.
--
-- VOR DEM LOESCHEN GEPRUEFT:
--   Keine Fundstelle mehr in src/, frontend/ oder den Cron-Dateien (alle vier Bereiche).
--   Portal: beide Routen bereinigt, Migration auf einer Wegwerf-Kopie vorweggenommen.
--   Homepage/CMS: bereinigt. Admin: Kalender und Einstellungsformular bereinigt.
--   GET /einstellungen liest per SELECT * -- die Spalten fehlen danach einfach.
--   Schreiben geprueft: Raster lesen, unveraendert speichern, Samstag auf 14:00 aendern,
--   zuruecksetzen -- alle drei HTTP 200, Werte in der Datenbank nachgezaehlt.

BEGIN;
ALTER TABLE einstellungen
  DROP COLUMN IF EXISTS mo_fr_von,
  DROP COLUMN IF EXISTS mo_fr_bis,
  DROP COLUMN IF EXISTS sa_offen,
  DROP COLUMN IF EXISTS sa_von,
  DROP COLUMN IF EXISTS sa_bis,
  DROP COLUMN IF EXISTS so_offen,
  DROP COLUMN IF EXISTS so_von,
  DROP COLUMN IF EXISTS so_bis,
  DROP COLUMN IF EXISTS mittagspause_von,
  DROP COLUMN IF EXISTS mittagspause_bis;
COMMIT;
