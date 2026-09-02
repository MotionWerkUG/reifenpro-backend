-- Unterschriften-Station: Am PC wird erfasst, das Dokument geht zum Unterschreiben an ein
-- separates Geraet (iPad, spaeter Unterschriftenpad). Das Geraet bekommt bewusst KEIN
-- Mitarbeiterkonto, sondern ein eigenes, eng begrenztes Merkmal — es darf ausschliesslich
-- den aktuellen Auftrag sehen und eine Unterschrift zurueckgeben.

CREATE TABLE IF NOT EXISTS signatur_stationen (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            text NOT NULL,
  geheimnis       text NOT NULL UNIQUE,      -- Merkmal des Geraets, ersetzt kein Passwort
  kopplungscode   text,                      -- 6-stellig, nur bis zur ersten Kopplung gueltig
  code_ablauf     timestamptz,
  gekoppelt_am    timestamptz,
  letzter_kontakt timestamptz,
  aktiv           boolean NOT NULL DEFAULT true,
  erstellt_am     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signatur_auftraege (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id    uuid NOT NULL REFERENCES signatur_stationen(id) ON DELETE CASCADE,
  titel         text NOT NULL,
  kunde_name    text,
  inhalt_html   text NOT NULL,
  unterschrift  text,                        -- PNG als Data-URL, vom Geraet zurueckgegeben
  status        text NOT NULL DEFAULT 'offen',  -- offen | unterschrieben | abgebrochen | abgelaufen
  erstellt_von  uuid REFERENCES users(id),
  erstellt_am   timestamptz NOT NULL DEFAULT now(),
  erledigt_am   timestamptz,
  ablauf_am     timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sig_auftrag_station ON signatur_auftraege (station_id, status);

-- Rechte NICHT vergessen: Die Anwendung verbindet als reifenpro_user, die Tabellen gehoeren
-- nach dem Anlegen ueber psql aber postgres. Ohne diese Zeilen antwortet die Station mit 500 —
-- genau dieser Fehler ist heute schon einmal passiert.
GRANT SELECT, INSERT, UPDATE, DELETE ON signatur_stationen, signatur_auftraege TO reifenpro_user;
