-- Folgeeinlagerung/Radsatz-Historie: verknuepft eine Wiedereinlagerung mit ihrer Vorgaenger-Einlagerung.
ALTER TABLE einlagerungen
  ADD COLUMN IF NOT EXISTS vorgaenger_id uuid REFERENCES einlagerungen(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_einl_vorgaenger ON einlagerungen(vorgaenger_id);
