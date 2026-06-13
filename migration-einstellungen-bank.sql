-- Migration: Bankverbindung + Zahlungsziel fuer Rechnungsmodul
-- Ausfuehren auf dem Server: sudo -u postgres psql -d reifenpro -f migration-einstellungen-bank.sql
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS bank             TEXT;
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS iban             TEXT;
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS bic              TEXT;
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS zahlungsziel_tage INTEGER DEFAULT 14;
