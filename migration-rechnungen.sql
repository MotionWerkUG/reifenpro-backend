-- Migration: Rechnungsmodul (Phase 4)
-- Ausfuehren: sudo -u postgres psql -d reifenpro -f migration-rechnungen.sql

CREATE TABLE IF NOT EXISTS rechnungen (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rechnungsnr          TEXT UNIQUE,                       -- NULL solange Entwurf
  status               TEXT NOT NULL DEFAULT 'entwurf',   -- entwurf | festgeschrieben | storniert
  kunden_id            uuid REFERENCES kunden(id),
  -- eingefrorene Empfaengerdaten (zum Ausstellungszeitpunkt)
  empfaenger_name      TEXT,
  empfaenger_firma     TEXT,
  empfaenger_strasse   TEXT,
  empfaenger_plz       TEXT,
  empfaenger_ort       TEXT,
  -- eingefrorener Aussteller-Snapshot (Firmenstammdaten)
  aussteller           jsonb,
  rechnungsdatum       DATE,
  leistungsdatum       DATE,
  faelligkeit          DATE,
  netto_summe          NUMERIC(10,2) NOT NULL DEFAULT 0,
  mwst_summe           NUMERIC(10,2) NOT NULL DEFAULT 0,
  brutto_summe         NUMERIC(10,2) NOT NULL DEFAULT 0,
  mwst_aufschluesselung jsonb,                            -- [{satz, netto, mwst}]
  zahlungsstatus       TEXT NOT NULL DEFAULT 'offen',     -- offen | bezahlt
  bezahlt_am           DATE,
  pdf_pfad             TEXT,
  storno_von_id        uuid REFERENCES rechnungen(id),    -- gesetzt bei Stornorechnung
  notizen              TEXT,
  erstellt_von         uuid REFERENCES users(id),
  erstellt_am          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  festgeschrieben_am   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rechnung_positionen (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rechnung_id       uuid NOT NULL REFERENCES rechnungen(id) ON DELETE CASCADE,
  position          INT NOT NULL DEFAULT 1,
  bezeichnung       TEXT NOT NULL,
  menge             NUMERIC(10,2) NOT NULL DEFAULT 1,
  einheit           TEXT,
  einzelpreis_netto NUMERIC(10,2) NOT NULL DEFAULT 0,
  mwst_satz         NUMERIC(4,1) NOT NULL DEFAULT 19,
  zeilen_netto      NUMERIC(10,2) NOT NULL DEFAULT 0,
  zeilen_brutto     NUMERIC(10,2) NOT NULL DEFAULT 0,
  artikel_id        uuid
);
CREATE INDEX IF NOT EXISTS idx_rechnung_positionen_rid ON rechnung_positionen(rechnung_id);

-- Lueckenloser Nummernkreis pro Jahr (RE-JJJJ-NNNN)
CREATE TABLE IF NOT EXISTS rechnung_counter (
  jahr      INT PRIMARY KEY,
  letzte_nr INT NOT NULL DEFAULT 0
);
