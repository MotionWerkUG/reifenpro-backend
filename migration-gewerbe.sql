ALTER TABLE kunden ADD COLUMN IF NOT EXISTS ist_gewerbe boolean DEFAULT false;
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS grosskunden_rabatt integer DEFAULT 0;
CREATE TABLE IF NOT EXISTS kunden_preise (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kunden_id uuid REFERENCES kunden(id) ON DELETE CASCADE,
  artikel_id uuid REFERENCES artikel(id) ON DELETE CASCADE,
  preis numeric NOT NULL,
  UNIQUE(kunden_id, artikel_id)
);
GRANT ALL ON kunden_preise TO reifenpro_user;
