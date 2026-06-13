-- Benötigte Spalten für automatische Erinnerungen
-- Ausführen mit: sudo -u postgres psql -d reifenpro -f cron-db-setup.sql

-- Spalte für Termin-Erinnerung (verhindert doppelten Versand)
ALTER TABLE termine ADD COLUMN IF NOT EXISTS erinnerung_gesendet BOOLEAN DEFAULT false;

-- Spalte für Saison-Erinnerung Einwilligung (falls noch nicht vorhanden)
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS einwilligung_saison_erinnerung BOOLEAN DEFAULT false;

-- Optional: HU-Fälligkeitsdatum pro Kunde (für HU-Warnung)
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS hu_faellig DATE;

-- Bestätigung
SELECT 'Spalten erfolgreich angelegt' AS status;
