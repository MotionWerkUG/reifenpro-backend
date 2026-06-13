-- Migration: Fahrzeuge (mehrere pro Kunde)
-- Ausfuehren: sudo -u postgres psql -d reifenpro -f migration-fahrzeuge.sql

CREATE TABLE IF NOT EXISTS fahrzeuge (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kunden_id    uuid NOT NULL REFERENCES kunden(id) ON DELETE CASCADE,
  typ          TEXT NOT NULL DEFAULT 'PKW',   -- PKW | SUV | Transporter | Motorrad | Sonstiges
  marke        TEXT,
  modell       TEXT,
  kennzeichen  TEXT,
  baujahr      INT,
  hu_datum     DATE,
  notiz        TEXT,
  erstellt_am  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  geaendert_am TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_fahrzeuge_kunde ON fahrzeuge(kunden_id);

GRANT ALL PRIVILEGES ON fahrzeuge TO reifenpro_user;

-- Bestehende Einzel-Fahrzeugdaten der Kunden uebernehmen (nur falls noch kein Fahrzeug erfasst)
INSERT INTO fahrzeuge (kunden_id, typ, marke, modell, kennzeichen, baujahr, hu_datum)
SELECT k.id,
       COALESCE(NULLIF(TRIM(k.fahrzeug_typ), ''), 'PKW'),
       k.fahrzeug_marke, k.fahrzeug_modell, k.kennzeichen, k.baujahr, k.hu_datum
FROM kunden k
WHERE k.aktiv = true
  AND (k.fahrzeug_marke IS NOT NULL OR k.fahrzeug_modell IS NOT NULL OR k.kennzeichen IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM fahrzeuge f WHERE f.kunden_id = k.id);
