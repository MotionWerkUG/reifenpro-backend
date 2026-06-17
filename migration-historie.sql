CREATE TABLE IF NOT EXISTS sektion_historie (
  id bigserial PRIMARY KEY,
  sektion_id uuid,
  daten jsonb,
  beschreibung text,
  geaendert_am timestamptz DEFAULT now()
);
GRANT ALL ON sektion_historie TO reifenpro_user;
GRANT USAGE, SELECT ON SEQUENCE sektion_historie_id_seq TO reifenpro_user;
