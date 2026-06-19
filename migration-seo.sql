ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS facebook_url text;
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS instagram_url text;
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS geo_breite text;
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS geo_laenge text;
