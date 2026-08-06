-- Editierbare SEO-Texte (Titel, Meta-Beschreibung, OG-Bild) je Website.
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS seo_config jsonb;
-- Strukturierte Bausteindaten (FAQ, Kundenstimmen, Galerie) + Alt-Text je Abschnitt.
ALTER TABLE homepage_sektionen ADD COLUMN IF NOT EXISTS daten jsonb;
ALTER TABLE homepage_sektionen ADD COLUMN IF NOT EXISTS bild_alt text;
