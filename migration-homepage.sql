-- Homepage-CMS: Abschnitte
CREATE TABLE IF NOT EXISTS homepage_sektionen (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  typ         TEXT NOT NULL DEFAULT 'text',  -- hero | leistung | text | oeffnungszeiten | kontakt
  sortierung  INT  NOT NULL DEFAULT 100,
  sichtbar    BOOLEAN NOT NULL DEFAULT true,
  headline    TEXT,
  subline     TEXT,
  inhalt      TEXT,
  bild_url    TEXT,
  cta_text    TEXT,
  cta_url     TEXT,
  erstellt_am  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  geaendert_am TIMESTAMPTZ
);
GRANT ALL PRIVILEGES ON homepage_sektionen TO reifenpro_user;

INSERT INTO homepage_sektionen (typ, sortierung, headline, subline, inhalt, bild_url, cta_text, cta_url)
SELECT * FROM (VALUES
  ('hero', 10, 'Reifenservice und Fahrzeugtechnik', 'Räderwechsel, Reifeneinlagerung und Service – schnell, fair und zuverlässig.', NULL, '/uploads/hero.jpg', 'Termin online buchen', '/portal/'),
  ('leistung', 20, 'Räderwechsel', NULL, 'Schneller Wechsel von Sommer- auf Winterräder und zurück – fachgerecht montiert und ausgewuchtet.', NULL, NULL, NULL),
  ('leistung', 30, 'Reifeneinlagerung', NULL, 'Wir lagern Ihre Räder sicher und trocken ein. Sie sparen Platz und kommen jede Saison entspannt vorbei.', NULL, NULL, NULL),
  ('leistung', 40, 'Reifen & Felgen', NULL, 'Beratung, Verkauf und Montage von Reifen und Felgen – passend zu Fahrzeug, Größe und Budget.', NULL, NULL, NULL),
  ('leistung', 50, 'HU & Service', NULL, 'Hauptuntersuchung und Fahrzeugservice rund ums Rad – alles aus einer Hand.', NULL, NULL, NULL),
  ('text', 60, 'Über uns', NULL, 'Schröder & Scholz steht für ehrlichen Reifenservice und solide Fahrzeugtechnik. Mit Erfahrung, modernem Equipment und einem fairen Preis-Leistungs-Verhältnis bringen wir Sie sicher durch jede Saison.', '/uploads/werkstatt.jpg', NULL, NULL),
  ('oeffnungszeiten', 70, 'Öffnungszeiten', NULL, NULL, NULL, NULL, NULL),
  ('kontakt', 80, 'Kontakt & Anfahrt', NULL, NULL, NULL, NULL, NULL)
) AS v(typ, sortierung, headline, subline, inhalt, bild_url, cta_text, cta_url)
WHERE NOT EXISTS (SELECT 1 FROM homepage_sektionen);
