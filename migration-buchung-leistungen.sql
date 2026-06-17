CREATE TABLE IF NOT EXISTS buchung_leistungen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artikel_id uuid REFERENCES artikel(id) ON DELETE CASCADE,
  rolle text NOT NULL DEFAULT 'haupt',
  titel text,
  beschreibung text,
  bild_url text,
  sortierung integer DEFAULT 0,
  aktiv boolean DEFAULT true,
  erstellt_am timestamptz DEFAULT now()
);
GRANT ALL ON buchung_leistungen TO reifenpro_user;
