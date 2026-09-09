-- Drei Spalten entfernen, die von nichts gelesen und von nichts gesetzt werden.
-- Aus der Frage des Inhabers nach Datenmuell (09.09.2026).
--
-- Vor dem Loeschen gemessen:
--   einstellungen.termine_pro_stunde   Wert 2. Ersetzt durch max_parallele_termine (Wert 1).
--                                      Die tote Spalte trug also eine ANDERE Zahl als die
--                                      Einstellung, die tatsaechlich gilt -- wer sie las,
--                                      haette den doppelten Andrang angenommen.
--   kunden.einwilligung_etikett        boolean, Vorgabe false, bei allen 4 Kunden false.
--                                      Keine erteilte Einwilligung geht verloren.
-- Keine Fundstelle in src/, frontend/, scripts/ oder den Cron-Dateien im Projektstamm.
--
-- NICHT geloescht wurde lager_config.reihen, obwohl sie auf der Liste stand: Die Datenbanksicht
-- v_statistiken rechnet daraus regale * reihen * plaetze = 1000 Plaetze. Die Sicht haengt an
-- GET /api/einlagerungen/statistiken, das keine Oberflaeche aufruft, und lager_config ist das
-- alte Lagermodell -- das aktuelle sind lager_orte + lager_regale. Der Aufraeumschnitt ist also
-- Route + Sicht + Tabelle, nicht eine Spalte; das gehoert vorgelegt, nicht nebenbei gemacht.
-- Das Werkzeug scripts/tote-spalten.sh hat die Spalte als tot gemeldet, weil es nur den
-- Anwendungscode durchsucht hat und keine Datenbankobjekte. Diese Luecke ist geschlossen.

BEGIN;
ALTER TABLE einstellungen DROP COLUMN IF EXISTS termine_pro_stunde;
ALTER TABLE kunden        DROP COLUMN IF EXISTS einwilligung_etikett;
COMMIT;
