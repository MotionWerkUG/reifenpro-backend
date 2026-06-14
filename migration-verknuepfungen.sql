-- Migration: Verknuepfungen Termin/Einlagerung <-> Fahrzeug + HU-Flag pro Fahrzeug
ALTER TABLE termine        ADD COLUMN IF NOT EXISTS fahrzeug_id uuid REFERENCES fahrzeuge(id);
ALTER TABLE einlagerungen  ADD COLUMN IF NOT EXISTS fahrzeug_id uuid REFERENCES fahrzeuge(id);
ALTER TABLE fahrzeuge      ADD COLUMN IF NOT EXISTS hu_erinnerung_gesendet BOOLEAN DEFAULT false;
