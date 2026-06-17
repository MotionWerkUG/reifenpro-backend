ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS buchung_aktiv boolean DEFAULT true;
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS buchung_titel text;
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS buchung_text text;
