-- Einmal-Token fuer den Upload eines unterschriebenen Scans (QR auf dem Ausdruck).
-- Ein JWT allein ist nicht widerrufbar; diese Tabelle macht "einmalig" und "nach dem
-- Nachdrucken verfaellt der alte QR" ueberhaupt erst durchsetzbar und protokolliert,
-- wann und von wo hochgeladen wurde.
CREATE TABLE IF NOT EXISTS dokument_scan_token (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  dokument_id   uuid NOT NULL REFERENCES kunden_dokumente(id) ON DELETE CASCADE,
  jti           text NOT NULL UNIQUE,
  erstellt_von  uuid,
  erstellt_am   timestamptz NOT NULL DEFAULT NOW(),
  gueltig_bis   timestamptz NOT NULL,
  verbraucht_am timestamptz,
  ip            text
);
-- Offene Token je Dokument finden (beim Neuausstellen werden sie entwertet).
CREATE INDEX IF NOT EXISTS idx_scan_token_dokument ON dokument_scan_token (dokument_id) WHERE verbraucht_am IS NULL;
