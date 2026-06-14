-- Migration: Preis-/Zeitstaffel je Fahrzeugtyp und Zollgroesse
-- Ausfuehren: sudo -u postgres psql -d reifenpro -f migration-artikel-preise.sql

CREATE TABLE IF NOT EXISTS artikel_preise (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  artikel_id    uuid NOT NULL REFERENCES artikel(id) ON DELETE CASCADE,
  fahrzeug_typ  TEXT,                         -- NULL/'' = alle Typen
  zoll_min      INT,                          -- NULL = keine Untergrenze
  zoll_max      INT,                          -- NULL = keine Obergrenze
  preis         NUMERIC(10,2) NOT NULL DEFAULT 0,   -- netto
  mwst_satz     NUMERIC(4,1)  NOT NULL DEFAULT 19,
  dauer_minuten INT,                          -- NULL = Standarddauer des Artikels
  erstellt_am   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_artikel_preise_artikel ON artikel_preise(artikel_id);
GRANT ALL PRIVILEGES ON artikel_preise TO reifenpro_user;
