ALTER TABLE kunden ADD COLUMN IF NOT EXISTS einwilligung_saison_bestaetigt boolean DEFAULT false;
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS einwilligung_saison_bestaetigt_am timestamptz;
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS einwilligung_token text;
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS einwilligung_token_ablauf timestamptz;
