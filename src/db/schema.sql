CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  password      TEXT NOT NULL,
  vorname       TEXT NOT NULL,
  nachname      TEXT NOT NULL,
  rolle         TEXT NOT NULL DEFAULT 'mitarbeiter'
                CHECK (rolle IN ('admin','mitarbeiter')),
  aktiv         BOOLEAN DEFAULT true,
  letzter_login TIMESTAMPTZ,
  erstellt_am   TIMESTAMPTZ DEFAULT NOW(),
  geaendert_am  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  ablauf_am   TIMESTAMPTZ NOT NULL,
  ip_adresse  INET,
  erstellt_am TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kunden (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kunden_nr       TEXT UNIQUE NOT NULL,
  vorname         TEXT NOT NULL,
  nachname        TEXT NOT NULL,
  firma           TEXT,
  strasse         TEXT,
  plz             TEXT,
  ort             TEXT,
  telefon         TEXT NOT NULL,
  telefon2        TEXT,
  email           TEXT,
  kennzeichen     TEXT,
  fahrzeug_marke  TEXT,
  fahrzeug_modell TEXT,
  baujahr         INTEGER,
  portal_aktiv       BOOLEAN DEFAULT false,
  portal_email       TEXT,
  portal_password    TEXT,
  portal_verifiziert BOOLEAN DEFAULT false,
  notizen         TEXT,
  aktiv           BOOLEAN DEFAULT true,
  erstellt_am     TIMESTAMPTZ DEFAULT NOW(),
  geaendert_am    TIMESTAMPTZ DEFAULT NOW(),
  erstellt_von    UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_kunden_name        ON kunden(nachname, vorname);
CREATE INDEX IF NOT EXISTS idx_kunden_kennzeichen ON kunden(kennzeichen);
CREATE INDEX IF NOT EXISTS idx_kunden_telefon     ON kunden(telefon);

CREATE TABLE IF NOT EXISTS lager_config (
  id       SERIAL PRIMARY KEY,
  regale   INTEGER NOT NULL DEFAULT 10,
  reihen   INTEGER NOT NULL DEFAULT 10,
  plaetze  INTEGER NOT NULL DEFAULT 10,
  geaendert_am TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO lager_config (regale, reihen, plaetze)
VALUES (10, 10, 10) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS einlagerungen (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  beleg_nr       TEXT UNIQUE NOT NULL,
  kunden_id      UUID NOT NULL REFERENCES kunden(id) ON DELETE RESTRICT,
  reifen_groesse TEXT NOT NULL,
  reifen_typ     TEXT NOT NULL CHECK (reifen_typ IN ('Winter','Sommer','Ganzjahr')),
  reifen_marke   TEXT,
  reifen_modell  TEXT,
  profil_vl      NUMERIC(4,1),
  profil_vr      NUMERIC(4,1),
  profil_hl      NUMERIC(4,1),
  profil_hr      NUMERIC(4,1),
  anzahl         INTEGER NOT NULL DEFAULT 4,
  felgen         TEXT DEFAULT 'Nein',
  dot            TEXT,
  lagerplatz     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'Eingelagert'
                 CHECK (status IN ('Eingelagert','Abholbereit','Abgeholt')),
  eingelagert_am DATE NOT NULL DEFAULT CURRENT_DATE,
  abholbereit_am TIMESTAMPTZ,
  abgeholt_am    TIMESTAMPTZ,
  bemerkungen    TEXT,
  erstellt_von   UUID REFERENCES users(id),
  geaendert_von  UUID REFERENCES users(id),
  erstellt_am    TIMESTAMPTZ DEFAULT NOW(),
  geaendert_am   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_einl_kunden_id  ON einlagerungen(kunden_id);
CREATE INDEX IF NOT EXISTS idx_einl_status     ON einlagerungen(status);
CREATE INDEX IF NOT EXISTS idx_einl_lagerplatz ON einlagerungen(lagerplatz);

CREATE TABLE IF NOT EXISTS termine (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kunden_id       UUID REFERENCES kunden(id) ON DELETE SET NULL,
  kontakt_name    TEXT NOT NULL,
  kontakt_telefon TEXT NOT NULL,
  kontakt_email   TEXT,
  datum           DATE NOT NULL,
  uhrzeit_von     TIME NOT NULL,
  uhrzeit_bis     TIME NOT NULL,
  termin_typ      TEXT NOT NULL CHECK (termin_typ IN (
                    'einlagerung','auslagerung','reifenwechsel',
                    'reifenkauf','inspektion','sonstiges')),
  kennzeichen     TEXT,
  beschreibung    TEXT,
  status          TEXT NOT NULL DEFAULT 'angefragt'
                  CHECK (status IN ('angefragt','bestaetigt','abgeschlossen','storniert')),
  notizen_intern  TEXT,
  erstellt_am     TIMESTAMPTZ DEFAULT NOW(),
  geaendert_am    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_termine_datum  ON termine(datum);
CREATE INDEX IF NOT EXISTS idx_termine_status ON termine(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id),
  aktion       TEXT NOT NULL,
  tabelle      TEXT,
  datensatz_id TEXT,
  alte_werte   JSONB,
  neue_werte   JSONB,
  ip_adresse   INET,
  erstellt_am  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empfaenger  TEXT NOT NULL,
  betreff     TEXT NOT NULL,
  typ         TEXT NOT NULL,
  status      TEXT DEFAULT 'gesendet',
  fehler_msg  TEXT,
  bezug_id    UUID,
  erstellt_am TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS seq_kunden_nr START 1;
CREATE SEQUENCE IF NOT EXISTS seq_beleg_nr  START 1;

CREATE OR REPLACE FUNCTION update_geaendert_am()
RETURNS TRIGGER AS $$
BEGIN NEW.geaendert_am = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_ts   ON users;
DROP TRIGGER IF EXISTS trg_kunden_ts  ON kunden;
DROP TRIGGER IF EXISTS trg_einl_ts    ON einlagerungen;
DROP TRIGGER IF EXISTS trg_termine_ts ON termine;

CREATE TRIGGER trg_users_ts   BEFORE UPDATE ON users         FOR EACH ROW EXECUTE FUNCTION update_geaendert_am();
CREATE TRIGGER trg_kunden_ts  BEFORE UPDATE ON kunden        FOR EACH ROW EXECUTE FUNCTION update_geaendert_am();
CREATE TRIGGER trg_einl_ts    BEFORE UPDATE ON einlagerungen FOR EACH ROW EXECUTE FUNCTION update_geaendert_am();
CREATE TRIGGER trg_termine_ts BEFORE UPDATE ON termine       FOR EACH ROW EXECUTE FUNCTION update_geaendert_am();

CREATE OR REPLACE VIEW v_statistiken AS
SELECT
  (SELECT COUNT(*) FROM kunden WHERE aktiv=true) AS kunden_gesamt,
  (SELECT COUNT(*) FROM einlagerungen WHERE status='Eingelagert') AS eingelagert,
  (SELECT COUNT(*) FROM einlagerungen WHERE status='Abholbereit') AS abholbereit,
  (SELECT regale*reihen*plaetze FROM lager_config LIMIT 1) AS kapazitaet,
  (SELECT regale*reihen*plaetze FROM lager_config LIMIT 1) -
  (SELECT COUNT(*) FROM einlagerungen WHERE status IN ('Eingelagert','Abholbereit')) AS freie_plaetze,
  (SELECT COUNT(*) FROM termine WHERE datum>=CURRENT_DATE AND status!='storniert') AS termine_offen;

-- ── Öffnungszeiten & Feiertage (Phase 2, additiv) ──
ALTER TABLE einstellungen ADD COLUMN IF NOT EXISTS bundesland text DEFAULT 'BY';

CREATE TABLE IF NOT EXISTS oeffnungszeiten (
  wochentag   int PRIMARY KEY,          -- 0=Mo .. 6=So
  geschlossen boolean DEFAULT false,
  von1 time, bis1 time,                 -- Vormittag / erste Spanne
  von2 time, bis2 time                  -- Nachmittag / zweite Spanne (optional)
);

CREATE TABLE IF NOT EXISTS besondere_tage (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  datum       date UNIQUE NOT NULL,
  bezeichnung text,
  geschlossen boolean DEFAULT true,
  von time, bis time,
  quelle      text DEFAULT 'manuell'    -- 'manuell' | 'feiertag'
);
