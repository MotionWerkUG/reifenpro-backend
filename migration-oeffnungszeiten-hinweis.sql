-- Freitext-Hinweis zu den Oeffnungszeiten (z. B. "Termine auch nach Vereinbarung").
-- Wird unter der Oeffnungszeiten-Tabelle der Website angezeigt und im CMS gepflegt.
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS oeffnungszeiten_hinweis TEXT;
