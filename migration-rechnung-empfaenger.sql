ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS empfaenger_anrede   text;
ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS empfaenger_vorname  text;
ALTER TABLE rechnungen ADD COLUMN IF NOT EXISTS empfaenger_nachname text;
