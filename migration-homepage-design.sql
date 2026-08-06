-- Homepage-Design: Typografie/Farben (design_config) + hochgeladene Schriften.
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS design_config jsonb;
CREATE TABLE IF NOT EXISTS homepage_fonts (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  label       text NOT NULL,          -- Anzeigename im CMS
  familie     text NOT NULL,          -- eindeutiger CSS-font-family-Name
  datei       text NOT NULL,          -- Dateiname unter uploads/fonts/
  format      text NOT NULL,          -- woff2 | woff | truetype | opentype
  erstellt_am timestamptz DEFAULT now()
);
-- App-Benutzer braucht Rechte auf die neue Tabelle (sonst "permission denied")
GRANT SELECT, INSERT, UPDATE, DELETE ON homepage_fonts TO reifenpro_user;
