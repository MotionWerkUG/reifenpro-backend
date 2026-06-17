CREATE TABLE IF NOT EXISTS gewerbe_anfragen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma text NOT NULL,
  anrede text,
  ansprechpartner text,
  ust_id text,
  telefon text,
  email text NOT NULL,
  anzahl_fahrzeuge integer,
  nachricht text,
  dokument_pfad text,
  dokument_name text,
  datenschutz_ip text,
  erledigt boolean DEFAULT false,
  erstellt_am timestamptz DEFAULT now()
);
GRANT ALL ON gewerbe_anfragen TO reifenpro_user;
