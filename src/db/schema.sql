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

-- Eigene Einwilligung fuer Bewertungsanfragen (getrennt von der Saison-Erinnerung; § 7 UWG / BGH VI ZR 225/17).
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS einwilligung_bewertung boolean DEFAULT false;
ALTER TABLE kunden ADD COLUMN IF NOT EXISTS einwilligung_bewertung_am timestamp with time zone;

-- ── GoBD: Unveraenderbarkeit festgeschriebener/stornierter Rechnungen (Deep-Test R2) ──
-- Sperrt jedes DELETE sowie das Aendern der eingefrorenen Inhalts-/Pflichtfelder, sobald eine
-- Rechnung festgeschrieben oder storniert ist. Erlaubt bleiben nur administrative Felder
-- (zahlungsstatus, bezahlt_am, mahnstufe, mahnung_am), der Statuswechsel
-- festgeschrieben->storniert und das EINMALIGE Setzen des PDF-Pfads (NULL->Wert, z. B. beim Storno).
CREATE OR REPLACE FUNCTION rechnung_schutz() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('festgeschrieben','storniert') THEN
      RAISE EXCEPTION 'GoBD: Festgeschriebene/stornierte Rechnung % darf nicht gelöscht werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('festgeschrieben','storniert') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'festgeschrieben' AND NEW.status = 'storniert') THEN
      RAISE EXCEPTION 'GoBD: Unzulässiger Statuswechsel % -> % (Rechnung %).', OLD.status, NEW.status, COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    IF NEW.rechnungsnr          IS DISTINCT FROM OLD.rechnungsnr
       OR NEW.kunden_id         IS DISTINCT FROM OLD.kunden_id
       OR NEW.empfaenger_anrede   IS DISTINCT FROM OLD.empfaenger_anrede
       OR NEW.empfaenger_vorname  IS DISTINCT FROM OLD.empfaenger_vorname
       OR NEW.empfaenger_nachname IS DISTINCT FROM OLD.empfaenger_nachname
       OR NEW.empfaenger_name     IS DISTINCT FROM OLD.empfaenger_name
       OR NEW.empfaenger_firma    IS DISTINCT FROM OLD.empfaenger_firma
       OR NEW.empfaenger_strasse  IS DISTINCT FROM OLD.empfaenger_strasse
       OR NEW.empfaenger_plz      IS DISTINCT FROM OLD.empfaenger_plz
       OR NEW.empfaenger_ort      IS DISTINCT FROM OLD.empfaenger_ort
       OR NEW.aussteller          IS DISTINCT FROM OLD.aussteller
       OR NEW.rechnungsdatum      IS DISTINCT FROM OLD.rechnungsdatum
       OR NEW.leistungsdatum      IS DISTINCT FROM OLD.leistungsdatum
       OR NEW.faelligkeit         IS DISTINCT FROM OLD.faelligkeit
       OR NEW.netto_summe         IS DISTINCT FROM OLD.netto_summe
       OR NEW.mwst_summe          IS DISTINCT FROM OLD.mwst_summe
       OR NEW.brutto_summe        IS DISTINCT FROM OLD.brutto_summe
       OR NEW.mwst_aufschluesselung IS DISTINCT FROM OLD.mwst_aufschluesselung
       OR NEW.storno_von_id       IS DISTINCT FROM OLD.storno_von_id
       OR NEW.festgeschrieben_am  IS DISTINCT FROM OLD.festgeschrieben_am
       OR NEW.erstellt_von        IS DISTINCT FROM OLD.erstellt_von
       OR NEW.erstellt_am         IS DISTINCT FROM OLD.erstellt_am
       OR NEW.notizen             IS DISTINCT FROM OLD.notizen THEN
      RAISE EXCEPTION 'GoBD/§14: Inhalt der festgeschriebenen Rechnung % ist unveränderbar.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
    IF OLD.pdf_pfad IS NOT NULL AND NEW.pdf_pfad IS DISTINCT FROM OLD.pdf_pfad THEN
      RAISE EXCEPTION 'GoBD: PDF der festgeschriebenen Rechnung % darf nicht ausgetauscht werden.', COALESCE(OLD.rechnungsnr, OLD.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rechnung_schutz ON rechnungen;
CREATE TRIGGER trg_rechnung_schutz
  BEFORE UPDATE OR DELETE ON rechnungen
  FOR EACH ROW EXECUTE FUNCTION rechnung_schutz();

-- Positionen einer festgeschriebenen/stornierten Rechnung sind unveraenderbar (UPDATE/DELETE gesperrt).
-- INSERT bleibt erlaubt, da der Storno seine Positionen nach dem Festschreiben-Status anlegt.
CREATE OR REPLACE FUNCTION rechnung_pos_schutz() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM rechnungen WHERE id = OLD.rechnung_id;
  IF st IN ('festgeschrieben','storniert') THEN
    RAISE EXCEPTION 'GoBD: Positionen einer festgeschriebenen Rechnung sind unveränderbar.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rechnung_pos_schutz ON rechnung_positionen;
CREATE TRIGGER trg_rechnung_pos_schutz
  BEFORE UPDATE OR DELETE ON rechnung_positionen
  FOR EACH ROW EXECUTE FUNCTION rechnung_pos_schutz();
