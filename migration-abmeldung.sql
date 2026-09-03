-- Abgemeldete Sitzungen.
--
-- BEFUND: Nach dem Abmelden blieb das Anmeldemerkmal acht Stunden lang gueltig. /auth/logout
-- protokollierte nur und loeschte hoechstens ein Erneuerungsmerkmal, das die Oberflaeche gar
-- nicht mitschickte -- dessen Gueltigkeit lag bei 30 Tagen. Wer das Merkmal einmal abgegriffen
-- hatte, kam damit weiter hinein, obwohl sich der Nutzer laengst abgemeldet hatte.
--
-- Merkmale sind signiert und tragen ihren Zustand selbst; man kann sie nicht zurueckrufen. Also
-- bekommt jede Anmeldung eine eigene Kennung (jti), und das Abmelden vermerkt genau diese hier.
-- Die Pruefung trifft damit NUR die Sitzung, die sich abgemeldet hat -- wer am Telefon
-- angemeldet ist, bleibt es, wenn er sich am Tresen abmeldet.
--
-- Die Zeilen werden nicht dauerhaft gebraucht: Nach Ablauf des Merkmals ist es ohnehin
-- ungueltig. Der naechtliche Lauf raeumt sie weg.
CREATE TABLE IF NOT EXISTS abgemeldete_sitzungen (
  jti         text PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  ablauf      timestamptz NOT NULL,
  erstellt_am timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abgemeldete_ablauf ON abgemeldete_sitzungen (ablauf);

GRANT SELECT, INSERT, DELETE ON abgemeldete_sitzungen TO reifenpro_user;
