-- Gutscheine/Aktionscodes
CREATE TABLE IF NOT EXISTS gutscheine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  beschreibung text,
  rabatt_prozent integer NOT NULL,
  gueltig_bis date,
  aktiv boolean DEFAULT true,
  erstellt_am timestamptz DEFAULT now()
);
GRANT ALL ON gutscheine TO reifenpro_user;

-- Aktionsbanner (Homepage) – global in den Einstellungen
ALTER TABLE einstellungen
  ADD COLUMN IF NOT EXISTS aktion_aktiv boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS aktion_text text,
  ADD COLUMN IF NOT EXISTS aktion_code text,
  ADD COLUMN IF NOT EXISTS aktion_position text DEFAULT 'leiste',
  ADD COLUMN IF NOT EXISTS aktion_link text;
