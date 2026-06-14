CREATE TABLE IF NOT EXISTS kontakt_anfragen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  telefon text,
  nachricht text NOT NULL,
  ip text,
  erledigt boolean DEFAULT false,
  erstellt_am timestamptz DEFAULT now()
);
GRANT ALL ON kontakt_anfragen TO reifenpro_user;
