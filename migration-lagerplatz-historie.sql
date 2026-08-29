-- Lagerplatz-Historie: wo lag ein Radsatz wann?
--
-- Anlass: Der Kunde kommt mit seinem Einlagerungsbeleg, auf dem "A-01-07" steht. Inzwischen wurde
-- der Satz umgelagert — etwa weil beim Stapeln der untere Satz herausging und der obere nachrutschte.
-- Ohne diese Spur findet der Tresen den Satz ueber den alten Platz nicht wieder, und es liesse sich
-- auch nicht belegen, wo er frueher lag. Der offene Eintrag (bis IS NULL) ist immer der aktuelle.
CREATE TABLE IF NOT EXISTS einlagerung_platz_historie (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  einlagerung_id uuid NOT NULL REFERENCES einlagerungen(id) ON DELETE CASCADE,
  lagerplatz     text NOT NULL,
  von            timestamptz NOT NULL DEFAULT now(),
  bis            timestamptz,
  grund          text,
  geaendert_von  uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_platz_historie_einlagerung ON einlagerung_platz_historie (einlagerung_id);
-- Suche des Tresens nach einem alten Platz vom Beleg
CREATE INDEX IF NOT EXISTS idx_platz_historie_platz ON einlagerung_platz_historie (lagerplatz);

-- Bestandsdaten: fuer jede bestehende Einlagerung den aktuellen Platz als offenen Eintrag anlegen,
-- damit die Historie ab sofort vollstaendig ist.
INSERT INTO einlagerung_platz_historie (einlagerung_id, lagerplatz, von, grund)
SELECT e.id, e.lagerplatz, COALESCE(e.erstellt_am, now()), 'Bestand bei Einfuehrung der Historie'
  FROM einlagerungen e
 WHERE e.lagerplatz IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM einlagerung_platz_historie h WHERE h.einlagerung_id = e.id);

-- Rechte: die Tabelle wird als postgres angelegt, die Anwendung laeuft als reifenpro_user.
-- Ohne diese Zeilen bekommt die Anwendung "permission denied" — genau daran ist der erste
-- Testlauf gescheitert, bevor die Migration produktiv war.
ALTER TABLE einlagerung_platz_historie OWNER TO reifenpro_user;
GRANT SELECT, INSERT, UPDATE ON einlagerung_platz_historie TO reifenpro_user;
